import os
import pymysql
from flask import Flask, request, jsonify
from cryptography.fernet import Fernet
from dotenv import load_dotenv
load_dotenv()
import re
from decimal import Decimal
from datetime import datetime, date
import json
import threading

app = Flask(__name__)
from flask_cors import CORS
CORS(app)

# -------------------------------------------------------
# Encryption setup
# Store ENCRYPTION_KEY as an environment variable - never hardcode it
# Generate one with: Fernet.generate_key()
# -------------------------------------------------------
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY")
fernet = Fernet(ENCRYPTION_KEY)

# -------------------------------------------------------
# Your app's own TDSQL connection (where credentials are stored)
# This is YOUR database, not the user's database
# -------------------------------------------------------
import sqlite3

def get_app_db():
    conn = sqlite3.connect('local_data.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_app_db()
    with conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS user_connections (
              id           TEXT PRIMARY KEY,
              name         TEXT NOT NULL,
              host         TEXT NOT NULL,
              port         INTEGER NOT NULL DEFAULT 3306,
              db_name      TEXT NOT NULL,
              username     TEXT NOT NULL,
              password_enc TEXT NOT NULL,
              db_type      TEXT NOT NULL DEFAULT 'mysql',
              created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS query_history (
              id               TEXT PRIMARY KEY,
              connection_id    TEXT NOT NULL,
              name             TEXT,
              prompt           TEXT NOT NULL,
              response_payload TEXT NOT NULL,
              created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (connection_id) REFERENCES user_connections(id)
            )
        ''')
    conn.close()

init_db()

# -------------------------------------------------------
# Step 1a: Fetch the encrypted credentials row from TDSQL
# -------------------------------------------------------
def fetch_creds_row(connection_id: str) -> dict | None:
    """
    Looks up the connection_id in the credentials table.
    Returns the raw row (with encrypted password), or None if not found.
    """
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                """
                SELECT id, host, port, db_name, username, password_enc
                FROM user_connections
                WHERE id = ?
                LIMIT 1
                """,
                (connection_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    finally:
        app_db.close()

# -------------------------------------------------------
# Step 1b: Decrypt the password from the stored row
# -------------------------------------------------------
def decrypt_password(password_enc: str) -> str:
    """
    Decrypts the Fernet-encrypted password back to plaintext.
    password_enc is stored as a UTF-8 string in TDSQL.
    """
    return fernet.decrypt(password_enc.encode()).decode()

# -------------------------------------------------------
# Step 1c: Open a connection to the USER's database
# -------------------------------------------------------
def open_user_connection(creds: dict) -> pymysql.Connection:
    """
    Opens a live connection to the user's own database
    using the decrypted credentials.
    Raises pymysql.OperationalError if the connection fails.
    """
    return pymysql.connect(
        host=creds["host"],
        port=int(creds["port"]),
        user=creds["username"],
        password=creds["password"],   # plaintext, decrypted just-in-time
        database=creds["db_name"],
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5             # fail fast if unreachable
    )

# -------------------------------------------------------
# Composed helper: the single function called by endpoints
# -------------------------------------------------------
def resolve_connection(connection_id: str) -> pymysql.Connection:
    """
    Full Step 1 in one call:
      1. Look up connection_id in TDSQL
      2. Decrypt the password
      3. Open and return a live connection to the user's DB

    Raises:
      ValueError          - connection_id not found
      pymysql.OperationalError - DB unreachable or bad credentials
    """
    row = fetch_creds_row(connection_id)
    if row is None:
        raise ValueError(f"No connection found for id: {connection_id}")

    plaintext_password = decrypt_password(row["password_enc"])

    creds = {
        "host":     row["host"],
        "port":     row["port"],
        "username": row["username"],
        "password": plaintext_password,
        "db_name":  row["db_name"],
    }

    return open_user_connection(creds)


def save_query_history(
        connection_id: str,
        text: str,
        data: list[dict],
        stats: list[dict],
        name: str = None,
) -> str | None:
    """
    Saves a query to history. Returns history_id or None on failure.
    Best-effort — never raises; history failures must not break a working query.

    Args:
        connection_id: which user DB this query is against
        text: the user's natural-language question
        data: query result rows (frontend's "data" field)
        stats: 3-item array of stat cards [{label, value, color}, ...]
        name: a brief summary of the question
    """
    try:
        history_id = str(uuid.uuid4())
        payload = json.dumps({"data": data, "stats": stats}, cls=MySQLEncoder)

        app_db = get_app_db()
        try:
            cursor = app_db.cursor()
            if True:
                cursor.execute(
                    """
                    INSERT INTO query_history
                        (id, connection_id, name, prompt, response_payload)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (history_id, connection_id, name, text, payload),
                )
            app_db.commit()
            return history_id
        finally:
            app_db.close()
    except Exception as e:
        print(f"WARN: failed to save history: {e}")
        return None

# -------------------------------------------------------
# Multi-turn conversation storage (Redis-backed)
# Stores the last N message pairs per connection_id so the
# agent can follow up on prior questions
# -------------------------------------------------------
CONVERSATION_TTL = 600  # 10 minutes of conversation idle time
MAX_HISTORY_TURNS = 4   # cap context to last 4 user+assistant pairs (8 messages)


def _conversation_key(connection_id: str) -> str:
    return f"conversation:{connection_id}"


def get_conversation(connection_id: str) -> list:
    """Returns the saved message history for this connection, or [] if none."""
    if not redis_client:
        return []
    try:
        raw = redis_client.get(_conversation_key(connection_id))
        return json.loads(raw) if raw else []
    except Exception as e:
        print(f"WARN: conversation read failed: {e}")
        return []


def save_conversation(connection_id: str, messages: list) -> None:
    if not redis_client:
        return
    try:
        # DEBUG: log what we're working with
        print(f"DEBUG save_conversation: {len(messages)} messages")
        for i, msg in enumerate(messages):
            content = msg.get("content")
            print(f"  msg[{i}] role={msg.get('role')} content_type={type(content).__name__}")
            if isinstance(content, list):
                for j, block in enumerate(content):
                    print(f"    block[{j}] type={type(block).__name__} has_model_dump={hasattr(block, 'model_dump')}")

        serializable = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                new_content = []
                for block in content:
                    if hasattr(block, "model_dump"):
                        new_content.append(block.model_dump())
                    elif isinstance(block, dict):
                        new_content.append(block)
                    else:
                        new_content.append({"type": "text", "text": str(block)})
                serializable.append({"role": msg["role"], "content": new_content})
            else:
                serializable.append({"role": msg["role"], "content": content})

        trimmed = serializable[-(2 * MAX_HISTORY_TURNS):]
        redis_client.setex(
            _conversation_key(connection_id),
            CONVERSATION_TTL,
            json.dumps(trimmed)
        )
        print(f"DEBUG save_conversation: SUCCESS, saved {len(trimmed)} messages")
    except Exception as e:
        print(f"WARN: conversation save failed: {e}")
        import traceback
        traceback.print_exc()


def clear_conversation(connection_id: str) -> None:
    if not redis_client:
        return
    try:
        redis_client.delete(_conversation_key(connection_id))
    except Exception as e:
        print(f"WARN: conversation clear failed: {e}")

# -------------------------------------------------------
# Step 2a: Query INFORMATION_SCHEMA on the user's database
# -------------------------------------------------------
INFORMATION_SCHEMA_QUERY = """
    SELECT
        c.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.COLUMN_KEY,
        c.COLUMN_DEFAULT,
        k.REFERENCED_TABLE_NAME,
        k.REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS c
    LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
        ON  c.TABLE_NAME   = k.TABLE_NAME
        AND c.COLUMN_NAME  = k.COLUMN_NAME
        AND c.TABLE_SCHEMA = k.TABLE_SCHEMA
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
    WHERE c.TABLE_SCHEMA = %s
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;
"""

def fetch_information_schema(conn: pymysql.Connection, db_name: str) -> list[dict]:
    """
    Runs the INFORMATION_SCHEMA query against the user's database.
    Returns a list of row dicts - one per column across all tables.
    No user data rows are read at any point.
    """
    with conn.cursor() as cursor:
        cursor.execute(INFORMATION_SCHEMA_QUERY, (db_name,))
        return cursor.fetchall()
    
# -------------------------------------------------------
# Step 2b: Compress raw rows into agent-friendly schema string
# -------------------------------------------------------
def compress_schema(rows: list[dict]) -> str:
    """
    Transforms raw INFORMATION_SCHEMA rows into a compact
    one-line-per-table format that minimises context window usage.
 
    Example output:
      customers(id int [PK, NOT NULL], email varchar [NOT NULL], country varchar)
      invoices(id int [PK], customer_id int [FK→customers.id], total decimal)
    """
    tables = {}
 
    for row in rows:
        table = row["TABLE_NAME"]
        if table not in tables:
            tables[table] = []
 
        annotations = []
 
        if row["COLUMN_KEY"] == "PRI":
            annotations.append("PK")
 
        if row["REFERENCED_TABLE_NAME"]:
            annotations.append(
                f"FK→{row['REFERENCED_TABLE_NAME']}.{row['REFERENCED_COLUMN_NAME']}"
            )
 
        if row["IS_NULLABLE"] == "NO":
            annotations.append("NOT NULL")
 
        if row["COLUMN_DEFAULT"] is not None:
            annotations.append(f"DEFAULT {row['COLUMN_DEFAULT']}")
 
        suffix = f" [{', '.join(annotations)}]" if annotations else ""
        tables[table].append(f"{row['COLUMN_NAME']} {row['DATA_TYPE']}{suffix}")
 
    lines = [
        f"{table}({', '.join(cols)})"
        for table, cols in tables.items()
    ]
    return "\n".join(lines)

import redis

# -------------------------------------------------------
# Redis cache (replaces in-memory schema_cache)
# Cold start: schema introspection takes ~200ms against a real DB.
# Warm cache: ~2ms read from Redis. 100x speedup on repeated queries.
# -------------------------------------------------------
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
CACHE_TTL = 300  # 5 minutes

try:
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        decode_responses=True,
        socket_connect_timeout=2,
    )
    redis_client.ping()  # fail fast if unreachable
    print(f"Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
except Exception as e:
    print(f"WARN: Redis unavailable ({e}), falling back to no-op cache")
    redis_client = None


def get_cached_schema(connection_id: str) -> str | None:
    """Returns the cached schema for a connection, or None on miss/Redis-down."""
    if not redis_client:
        return None
    try:
        return redis_client.get(f"schema:{connection_id}")
    except Exception as e:
        print(f"WARN: Redis get failed: {e}")
        return None


def set_cached_schema(connection_id: str, schema: str) -> None:
    """Caches a schema for CACHE_TTL seconds. Silent on failure."""
    if not redis_client:
        return
    try:
        redis_client.setex(f"schema:{connection_id}", CACHE_TTL, schema)
    except Exception as e:
        print(f"WARN: Redis set failed: {e}")

# -------------------------------------------------------
# GET /schema  — full endpoint wiring Steps 1 + 2 together
# -------------------------------------------------------
@app.route("/schema", methods=["GET"])
def get_schema():
    connection_id = request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400
 
    # Return cached schema if still fresh
    cached = get_cached_schema(connection_id)
    if cached:
        return jsonify({"schema": cached, "cached": True})
 
    # Step 1 — resolve connection
    try:
        conn = resolve_connection(connection_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except pymysql.OperationalError as e:
        return jsonify({"error": "Could not connect to database", "detail": str(e)}), 503
# Step 2 — introspect and compress
    try:
        row = fetch_creds_row(connection_id)       # re-fetch to get db_name
        rows = fetch_information_schema(conn, row["db_name"])

        if not rows:
            return jsonify({"error": "No tables found in database"}), 200

        schema = compress_schema(rows)
        set_cached_schema(connection_id, schema)

        return jsonify({"schema": schema, "cached": False})

    except pymysql.Error as e:
        return jsonify({"error": "Schema introspection failed", "detail": str(e)}), 500

    finally:
        conn.close()   # always release the connection


import uuid

# -------------------------------------------------------
# POST /connections — save a new user DB connection
# Returns the connection_id to be used in X-Connection-Id header
# -------------------------------------------------------
@app.route("/connections", methods=["POST"])
def create_connection():
    data = request.get_json() or {}
    required = ["name", "host", "db_name", "username", "password"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    try:
        test_conn = pymysql.connect(
            host=data["host"],
            port=int(data.get("port", 3306)),
            user=data["username"],
            password=data["password"],
            database=data["db_name"],
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5
        )
        with test_conn.cursor() as cursor:
            cursor.execute("SELECT 1")
        test_conn.close()
    except pymysql.OperationalError as e:
        return jsonify({"error": "Could not connect to database", "detail": str(e)}), 400

    password_enc = fernet.encrypt(data["password"].encode()).decode()
    connection_id = str(uuid.uuid4())

    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                """
                INSERT INTO user_connections
                  (id, name, host, port, db_name, username, password_enc, db_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    connection_id,
                    data["name"],
                    data["host"],
                    data.get("port", 3306),
                    data["db_name"],
                    data["username"],
                    password_enc,
                    data.get("db_type", "mysql"),
                ),
            )
        app_db.commit()
    finally:
        app_db.close()

    try:
        warm_conn = resolve_connection(connection_id)
        rows = fetch_information_schema(warm_conn, data["db_name"])
        if rows:
            schema = compress_schema(rows)
            set_cached_schema(connection_id, schema)
        warm_conn.close()
    except Exception as e:
        print(f"WARN: schema pre-warm failed for {connection_id}: {e}")

    return jsonify({"connection_id": connection_id})


# -------------------------------------------------------
# GET /connections — list saved connections (no passwords)
# -------------------------------------------------------
@app.route("/connections", methods=["GET"])
def list_connections():
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                """
                SELECT id, name, host, port, db_name AS `database`, db_type AS type, created_at                
                FROM user_connections
                ORDER BY created_at DESC
                """
            )
            rows = [dict(r) for r in cursor.fetchall()]
            for r in rows:
                if r.get("created_at"):
                    # Handle sqlite string timestamp
                    if isinstance(r["created_at"], str):
                        r["created_at"] = r["created_at"].replace(" ", "T")
                    else:
                        r["created_at"] = r["created_at"].isoformat()
                r["status"] = "online"
            return jsonify(rows)
    finally:
        app_db.close()


# -------------------------------------------------------
# POST /connections/<id>/test — verify a connection works
# -------------------------------------------------------
@app.route("/connections/<connection_id>/test", methods=["POST"])
def test_connection(connection_id):
    try:
        conn = resolve_connection(connection_id)
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            cursor.fetchone()
        conn.close()
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503

# -------------------------------------------------------
# Step 1a: Strip SQL comments and whitespace
# Must run before any validation so comments can't be
# used to hide malicious tokens e.g. SELECT /*DROP*/ 1
# -------------------------------------------------------
def clean_sql(sql: str) -> str:
    """
    Removes SQL comments and normalises whitespace.
    Handles both -- single-line and /* multi-line */ comments.
 
    Examples:
      "-- get revenue\nSELECT total FROM invoices"  →  "SELECT total FROM invoices"
      "SELECT /* sneaky */ total FROM invoices"      →  "SELECT  total FROM invoices"
    """
    # remove -- single-line comments
    cleaned = re.sub(r"--[^\n]*", "", sql, flags=re.MULTILINE)
    # remove /* ... */ multi-line comments
    cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
    # collapse extra whitespace
    return cleaned.strip()

# -------------------------------------------------------
# Step 1b: Validate the cleaned SQL is safe to execute
# Raises ValueError with a descriptive message on failure
# so the endpoint can return it directly to the caller
# -------------------------------------------------------
def validate_sql(sql: str) -> None:
    """
    Validates that a SQL string is safe to pass to run_query.
    Must be called with the output of clean_sql(), not raw input.
 
    Checks:
      1. Non-empty after cleaning
      2. First token is SELECT (allowlist — rejects INSERT, UPDATE,
         DELETE, DROP, EXEC, etc.)
      3. No stacked statements (semicolons mid-query)
 
    Raises:
      ValueError - with a human-readable reason on any failed check.
      Returns normally if all checks pass.
 
    Usage:
      cleaned = clean_sql(raw_sql)
      validate_sql(cleaned)        # raises ValueError if unsafe
      # safe to execute from here
    """
    if not sql:
        raise ValueError("SQL statement cannot be empty.")
 
    # check first token is SELECT
    first_token = sql.split()[0].upper()
    if first_token != "SELECT":
        raise ValueError(
            f"Only SELECT statements are permitted. Got: {first_token}"
        )
 
    # check for stacked statements — strip one trailing semicolon then
    # look for any remaining semicolons inside the query body
    if ";" in sql.rstrip(";"):
        raise ValueError(
            "Stacked statements are not permitted. "
            "Remove any semicolons from the middle of your query."
        )
    
# -------------------------------------------------------
# Step 2a: Inject a LIMIT clause if one is not present
# Fetches ROW_CAP + 1 rows so we can detect truncation
# without pulling the entire result set into memory
# -------------------------------------------------------
ROW_CAP = 500
 
def apply_row_cap(sql: str) -> str:
    """
    Appends a LIMIT clause to the query if one is not already present.
    Requests ROW_CAP + 1 rows so execute_query() can detect whether
    the full result was returned or silently truncated.
 
    Examples:
      "SELECT * FROM invoices"          ->  "SELECT * FROM invoices LIMIT 501"
      "SELECT * FROM invoices LIMIT 10" ->  "SELECT * FROM invoices LIMIT 10"  (unchanged)
 
    Must be called after validate_sql() - assumes input is a clean SELECT.
    """
    if re.search(r"\bLIMIT\b", sql, flags=re.IGNORECASE):
        return sql  # user already specified a LIMIT - respect it
    return f"{sql.rstrip(';')} LIMIT {ROW_CAP + 1}"

# -------------------------------------------------------
# Step 2b: Custom JSON encoder for MySQL types
# pymysql returns Decimal and datetime objects that the
# default json.JSONEncoder cannot serialise
# -------------------------------------------------------
class MySQLEncoder(json.JSONEncoder):
    """
    Extends the default JSON encoder to handle types that
    pymysql returns from MySQL but that are not natively
    JSON-serialisable:
 
      Decimal   ->  float   (monetary / numeric columns)
      datetime  ->  str     (ISO 8601 format: "2024-03-15T14:30:00")
      date      ->  str     (ISO 8601 format: "2024-03-15")
 
    Usage:
      json.dumps(rows, cls=MySQLEncoder)
    """
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, bytes):
            # Try to decode as UTF-8, otherwise return hex representation
            try:
                return obj.decode('utf-8')
            except UnicodeDecodeError:
                return obj.hex()
        return super().default(obj)
    
# -------------------------------------------------------
# Step 2c: Execute the capped query and return results
# This is the only place in the app that reads user data
# -------------------------------------------------------
def execute_query(conn: pymysql.Connection, sql: str) -> dict:
    """
    Executes a validated, row-capped SELECT query and returns
    a result dict ready to be passed to jsonify().
 
    Expects sql to have already passed through:
      1. clean_sql()
      2. validate_sql()
      3. apply_row_cap()
 
    Sets a 5-second server-side query timeout before executing
    so runaway queries are killed at the database level, not
    just abandoned on the Python side.
 
    Returns:
      {
        "columns":   ["id", "name", "total"],   # column names in order
        "rows":      [{...}, {...}],             # up to ROW_CAP rows as dicts
        "row_count": 42,                         # number of rows returned
        "truncated": False                       # True if result exceeded ROW_CAP
      }
 
    Raises:
      pymysql.OperationalError  - query timeout or connection lost
      pymysql.ProgrammingError  - SQL syntax error in the query
    """
    with conn.cursor() as cursor:
        # kill the query server-side if it runs over 5 seconds
        cursor.execute("SET SESSION MAX_EXECUTION_TIME=5000")
 
        cursor.execute(sql)
        raw_rows = cursor.fetchall()  # list of dicts via DictCursor
 
    # detect truncation: if we got ROW_CAP + 1 back, there were more rows
    truncated = len(raw_rows) > ROW_CAP
    rows = raw_rows[:ROW_CAP]  # slice off the extra sentinel row if present
 
    # extract column names from the first row's keys (order preserved in Python 3.7+)
    columns = list(rows[0].keys()) if rows else []
 
    return {
        "columns":   columns,
        "rows":      rows,
        "row_count": len(rows),
        "truncated": truncated,
    }

# -------------------------------------------------------
# Step 3: Execute with full timeout coverage
# Two-layer timeout: client-side (socket) + server-side (MySQL)
# -------------------------------------------------------
 
QUERY_TIMEOUT = 5  # seconds
 
def execute_query_with_timeout(conn: pymysql.Connection, sql: str) -> dict:
    """
    Wraps execute_query() with a client-side thread timeout so that
    network hangs or unresponsive servers cannot block a Flask worker
    indefinitely.
 
    Two timeout layers work together:
      1. Client-side (this function): a threading.Timer cancels execution
         after QUERY_TIMEOUT seconds if the DB has not responded at all.
         Catches network hangs, stalled connections, unresponsive hosts.
      2. Server-side (inside execute_query): SET SESSION MAX_EXECUTION_TIME
         asks MySQL to kill the query after QUERY_TIMEOUT seconds.
         Catches slow queries that do reach the DB and begin executing.
 
    Both layers are needed because:
      - Server-side alone cannot help if the network never delivers the query.
      - Client-side alone cannot kill a query already running on the DB server,
        leaving orphaned queries consuming server resources.
 
    Returns:
      Same dict as execute_query():
      {
        "columns":   [...],
        "rows":      [...],
        "row_count": int,
        "truncated": bool
      }
 
    Raises:
      TimeoutError          - client-side timeout fired (no DB response)
      pymysql.OperationalError - server-side timeout fired (query too slow)
      pymysql.ProgrammingError - SQL syntax error
    """
    result = {}
    exception = {}
 
    def target():
        try:
            result["data"] = execute_query(conn, sql)
        except Exception as e:
            exception["error"] = e
 
    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout=QUERY_TIMEOUT)
 
    if thread.is_alive():
        # thread is still blocked on the DB call — connection is unresponsive
        # close the connection to unblock the thread and free the socket
        try:
            conn.close()
        except Exception:
            pass
        raise TimeoutError(
            f"Query did not respond within {QUERY_TIMEOUT} seconds."
        )
 
    if "error" in exception:
        raise exception["error"]
 
    return result["data"]

# -------------------------------------------------------
# Step 4a: Serialise the result dict using MySQLEncoder
# Converts the raw dict from execute_query_with_timeout
# into a JSON-safe structure the agent can consume
# -------------------------------------------------------
def serialise_result(result: dict) -> dict:
    """
    Takes the raw result dict from execute_query_with_timeout and
    ensures every value in every row is JSON-safe.
 
    pymysql's DictCursor returns Python-native types that map cleanly
    to JSON (str, int, float, bool, None) but also returns types that
    do not: Decimal for numeric/monetary columns, datetime/date for
    timestamp columns. MySQLEncoder handles these conversions.
 
    The approach here is to round-trip the result through json.dumps
    (using MySQLEncoder) then json.loads — this gives us back a plain
    Python dict where every value is guaranteed to be JSON-safe,
    without having to walk the rows manually.
 
    Returns:
      A new dict with the same shape as the input but with all values
      converted to JSON-native types:
      {
        "columns":   ["id", "name", "total", "created_at"],
        "rows":      [{"id": 1, "name": "Alice", "total": 9.99,
                       "created_at": "2024-03-15T14:30:00"}, ...],
        "row_count": 1,
        "truncated": False
      }
    """
    # dumps → loads round-trip: MySQLEncoder converts non-serialisable
    # types during dumps; loads converts the resulting JSON string back
    # to a plain Python dict with only JSON-native types inside
    return json.loads(
        json.dumps(result, cls=MySQLEncoder)
    )
 
 
# -------------------------------------------------------
# Step 4b: Build the final response body
# Adds metadata the agent needs to reason about the result
# and wraps everything in a single flat dict for jsonify()
# -------------------------------------------------------
def build_response(serialised: dict, sql: str) -> dict:
    """
    Wraps the serialised result in a response envelope that includes
    metadata the agent needs alongside the raw data:
 
      sql        - the exact query that was executed (post-cap injection),
                   so the agent can reference it in its reasoning and the
                   user can inspect what ran against their database
      columns    - ordered list of column names; the agent uses these to
                   understand what each positional value in a row means
      rows       - the actual data rows, each a dict keyed by column name
      row_count  - number of rows returned after the cap was applied;
                   saves the agent from having to count len(rows) itself
      truncated  - boolean flag; when True the agent must caveat its answer
                   (e.g. "based on the first 500 rows...") because it may
                   not have seen the full result set
 
    Args:
      serialised - the output of serialise_result()
      sql        - the capped SQL string that was executed
 
    Returns:
      A flat dict ready to be passed directly to Flask's jsonify()
    """
    return {
        "sql":       sql,
        "columns":   serialised["columns"],
        "rows":      serialised["rows"],
        "row_count": serialised["row_count"],
        "truncated": serialised["truncated"],
    }
 
 
# -------------------------------------------------------
# Step 4c: Full /query pipeline in one call
# Composes all steps: clean → validate → cap → execute
# → serialise → build response
# Call this from the /query endpoint
# -------------------------------------------------------
def run_query_pipeline(conn: pymysql.Connection, raw_sql: str) -> dict:
    """
    Runs the complete query pipeline from raw SQL string to a
    response-ready dict. This is the single function the /query
    endpoint calls — it composes every prior step in the correct order.
 
    Pipeline:
      1. clean_sql()                   - strip comments, normalise whitespace
      2. validate_sql()                - allowlist check + stacked stmt check
      3. apply_row_cap()               - inject LIMIT if not present
      4. execute_query_with_timeout()  - run against DB with dual timeouts
      5. serialise_result()            - convert MySQL types to JSON-safe types
      6. build_response()              - wrap in response envelope with metadata
 
    Args:
      conn    - a live pymysql connection from resolve_connection()
      raw_sql - the raw SQL string received from the agent in the request body
 
    Returns:
      A dict ready to be passed to Flask's jsonify()
 
    Raises:
      ValueError               - empty SQL or non-SELECT or stacked statements
      TimeoutError             - query did not respond within QUERY_TIMEOUT
      pymysql.OperationalError - DB connection lost or server-side timeout
      pymysql.ProgrammingError - SQL syntax error
    """
    cleaned = clean_sql(raw_sql)
    validate_sql(cleaned)                                   # raises ValueError if unsafe
    capped = apply_row_cap(cleaned)
    result = execute_query_with_timeout(conn, capped)   # raises on timeout/DB error
    serialised = serialise_result(result)
    return build_response(serialised, capped)

@app.route("/query", methods=["POST"])
def query():
    connection_id = request.headers.get("X-Connection-Id")
    body = request.get_json()
    raw_sql = body.get("sql", "").strip()

    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400
    if not raw_sql:
        return jsonify({"error": "Missing sql field"}), 400

    conn = None

    try:
        conn = resolve_connection(connection_id)
        response = run_query_pipeline(conn, raw_sql)
        return jsonify(response), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except TimeoutError as e:
        return jsonify({"error": str(e)}), 504
    except pymysql.OperationalError as e:
        return jsonify({"error": "Database error", "detail": str(e)}), 503
    except pymysql.ProgrammingError as e:
        return jsonify({"error": "SQL syntax error", "detail": str(e)}), 422
    finally:
        if conn:
            conn.close()


# -------------------------------------------------------
# GET /history?connection_id=...&limit=20
# Returns array of history entries shaped for frontend rendering
# -------------------------------------------------------
@app.route("/history", methods=["GET"])
def list_history():
    connection_id = request.args.get("connection_id") or request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing connection_id"}), 400

    limit = min(int(request.args.get("limit", 20)), 100)

    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                """
                SELECT id, connection_id, name, prompt, response_payload, created_at
                FROM query_history
                WHERE connection_id = ?
                ORDER BY created_at DESC
                    LIMIT ?
                """,
                (connection_id, limit),
            )
            rows = [dict(r) for r in cursor.fetchall()]
            result = []
            for r in rows:
                payload = r["response_payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                
                # Handle sqlite string timestamp
                created_at_str = None
                if r.get("created_at"):
                    if isinstance(r["created_at"], str):
                        created_at_str = r["created_at"].replace(" ", "T") + "Z"
                    else:
                        created_at_str = r["created_at"].isoformat() + "Z"

                result.append({
                    "id": r["id"],
                    "connection_id": r["connection_id"],
                    "name": r.get("name") or r["prompt"],
                    "text": r["prompt"],
                    "created_at": created_at_str,
                    "data": payload.get("data", []),
                    "stats": payload.get("stats", []),
                })
            return jsonify(result)
    finally:
        app_db.close()


# -------------------------------------------------------
# GET /history/<id> — single entry, same shape as list items
# -------------------------------------------------------
@app.route("/history/<history_id>", methods=["GET"])
def get_history_entry(history_id):
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                """
                SELECT id, connection_id, prompt, response_payload, created_at
                FROM query_history
                WHERE id = ? LIMIT 1
                """,
                (history_id,),
            )
            r = cursor.fetchone()
            if not r:
                return jsonify({"error": "Not found"}), 404
                
            r = dict(r)

            payload = r["response_payload"]
            if isinstance(payload, str):
                payload = json.loads(payload)
                
            created_at_str = None
            if r.get("created_at"):
                if isinstance(r["created_at"], str):
                    created_at_str = r["created_at"].replace(" ", "T")
                else:
                    created_at_str = r["created_at"].isoformat()

            return jsonify({
                "id": r["id"],
                "connection_id": r["connection_id"],
                "text": r["prompt"],
                "timestamp": created_at_str,
                "data": payload.get("data", []),
                "stats": payload.get("stats", []),
            })
    finally:
        app_db.close()


# -------------------------------------------------------
# DELETE /history/<id> — remove a single history entry
# -------------------------------------------------------
@app.route("/history/<history_id>", methods=["DELETE"])
def delete_history_entry(history_id):
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute("DELETE FROM query_history WHERE id = ?", (history_id,))
            app_db.commit()
            return jsonify({"deleted": cursor.rowcount > 0})
    finally:
        app_db.close()

def validate_table_name(table_name: str) -> None:
    """
    Rejects any table name that contains characters outside
    a-z, A-Z, 0-9, and underscore. This prevents SQL injection
    via the URL parameter.
    """
    if not re.match(r"^[a-zA-Z0-9_]+$", table_name):
        raise ValueError(
            f"Invalid table name: '{table_name}'. "
            "Only alphanumeric characters and underscores are permitted."
        )

def validate_table_exists(connection_id: str, table_name: str) -> None:
    """
    Checks the cached schema for connection_id to confirm
    table_name is a real table in the user's database.
    Raises ValueError if the schema isn't cached yet or the
    table isn't found.
    """
    schema = get_cached_schema(connection_id)
    if schema is None:
        raise ValueError(
            "Schema not loaded. Call GET /schema before GET /sample."
        )
    # each line of the compressed schema starts with the table name
    # followed by an opening parenthesis e.g. "invoices(id int [PK]...)"
    table_names = [line.split("(")[0] for line in schema.strip().splitlines()]
    if table_name not in table_names:
        raise ValueError(
            f"Table '{table_name}' not found in database."
        )
    
SAMPLE_SIZE = 5

def fetch_sample_rows(conn: pymysql.Connection, table_name: str) -> dict:
    """
    Executes SELECT * FROM {table_name} LIMIT {SAMPLE_SIZE}
    and returns serialised rows with column names.
    """
    sql = f"SELECT * FROM `{table_name}` LIMIT {SAMPLE_SIZE}"
    with conn.cursor() as cursor:
        cursor.execute(sql)
        raw_rows = cursor.fetchall()

    columns = list(raw_rows[0].keys()) if raw_rows else []
    serialised = json.loads(json.dumps(raw_rows, cls=MySQLEncoder))

    return {
        "table":     table_name,
        "columns":   columns,
        "rows":      serialised,
        "row_count": len(serialised),
    }

@app.route("/sample/<table_name>", methods=["GET"])
def get_sample(table_name):
    connection_id = request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400

    conn = None  # ← ensures finally block is always safe
    try:
        validate_table_name(table_name)
        validate_table_exists(connection_id, table_name)
        conn = resolve_connection(connection_id)
        result = fetch_sample_rows(conn, table_name)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except pymysql.OperationalError as e:
        return jsonify({"error": "Could not connect to database", "detail": str(e)}), 503
    finally:
        if conn:  # ← now safe — None is falsy so close() is skipped
            conn.close()

# -------------------------------------------------------
# Robust Transcription Engine
# -------------------------------------------------------
import speech_recognition as sr
import io

@app.route("/transcribe", methods=["POST"])
def transcribe():
    """
    Handles raw audio uploads from the frontend and converts
    them to text using the SpeechRecognition engine.
    """
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files['audio']
    recognizer = sr.Recognizer()

    try:
        # Load audio data from the uploaded file
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)

        # Recognize speech using Google's free web service
        # For production, swap for a more robust provider like Whisper
        text = recognizer.recognize_google(audio_data)

        return jsonify({"text": text})
    except sr.UnknownValueError:
        return jsonify({"error": "Speech was unintelligible"}), 422
    except sr.RequestError as e:
        return jsonify({"error": f"Recognition service failure: {e}"}), 503
    except Exception as e:
        return jsonify({"error": f"Transcription error: {str(e)}"}), 500

# -------------------------------------------------------
# TRTC voice integration (Legacy/Placeholder)
# -------------------------------------------------------
import TLSSigAPIv2
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.trtc.v20190722 import trtc_client, models as trtc_models


TRTC_SDK_APP_ID = int(os.environ.get("TRTC_SDK_APP_ID", "0"))
TRTC_SDK_SECRET_KEY = os.environ.get("TRTC_SDK_SECRET_KEY", "")
TENCENT_SECRET_ID = os.environ.get("TENCENT_SECRET_ID", "")
TENCENT_SECRET_KEY = os.environ.get("TENCENT_SECRET_KEY", "")
TRTC_REGION = os.environ.get("TRTC_REGION", "ap-singapore")

_usersig_api = TLSSigAPIv2.TLSSigAPIv2(TRTC_SDK_APP_ID, TRTC_SDK_SECRET_KEY)


def _trtc_client():
    cred = credential.Credential(TENCENT_SECRET_ID, TENCENT_SECRET_KEY)
    http_profile = HttpProfile()
    http_profile.endpoint = "trtc.tencentcloudapi.com"
    client_profile = ClientProfile()
    client_profile.httpProfile = http_profile
    return trtc_client.TrtcClient(cred, TRTC_REGION, client_profile)


@app.route("/trtc/usersig", methods=["POST"])
def trtc_usersig():
    data = request.get_json() or {}
    user_id = data.get("user_id") or f"user_{uuid.uuid4().hex[:8]}"
    expire_seconds = int(data.get("expire_seconds", 86400))
    usersig = _usersig_api.gen_sig(user_id, expire_seconds)
    return jsonify({
        "user_id": user_id,
        "sdk_app_id": TRTC_SDK_APP_ID,
        "user_sig": usersig,
        "expire_seconds": expire_seconds,
    })


@app.route("/trtc/start-transcription", methods=["POST"])
def trtc_start_transcription():
    data = request.get_json() or {}
    room_id = data.get("room_id")
    if not room_id:
        return jsonify({"error": "Missing room_id"}), 400
    try:
        client = _trtc_client()
        req = trtc_models.StartAITranscriptionRequest()
        req.from_json_string(json.dumps({
            "SdkAppId": TRTC_SDK_APP_ID,
            "RoomId": str(room_id),
            "RoomIdType": 0,
            "TranscriptionParams": {
                "UserId": f"ai_bot_{room_id}",
                "UserSig": _usersig_api.gen_sig(f"ai_bot_{room_id}", 86400),
            },
        }))
        resp = client.StartAITranscription(req)
        return jsonify({"task_id": resp.TaskId})
    except Exception as e:
        return jsonify({"error": "Failed to start transcription", "detail": str(e)}), 500


@app.route("/trtc/stop-transcription", methods=["POST"])
def trtc_stop_transcription():
    data = request.get_json() or {}
    task_id = data.get("task_id")
    if not task_id:
        return jsonify({"error": "Missing task_id"}), 400
    try:
        client = _trtc_client()
        req = trtc_models.StopAITranscriptionRequest()
        req.from_json_string(json.dumps({"TaskId": task_id}))
        client.StopAITranscription(req)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": "Failed to stop transcription", "detail": str(e)}), 500

# -------------------------------------------------------
# POST /ask — natural language to query results
# Wraps run_agent (agent.py), extracts SQL/rows from the
# tool calls, generates stat cards via a follow-up Claude
# call, saves to history, returns frontend-shaped response
# -------------------------------------------------------
from agent import run_agent, client as anthropic_client, MODEL as ANTHROPIC_MODEL


def serialize_messages(messages: list) -> list[dict]:
    """
    Converts the agent's message history into a JSON-serializable format.
    Anthropic SDK returns ContentBlock objects that can't be directly serialized,
    so we need to convert them to plain dicts.
    """
    serialized = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")

        if isinstance(content, str):
            # Simple string content
            serialized.append({"role": role, "content": content})
        elif isinstance(content, list):
            # Content is a list of blocks (text, tool_use, tool_result)
            serialized_content = []
            for block in content:
                if hasattr(block, "type"):
                    # This is an Anthropic SDK object
                    if block.type == "text":
                        serialized_content.append({"type": "text", "text": block.text})
                    elif block.type == "tool_use":
                        serialized_content.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input
                        })
                elif isinstance(block, dict):
                    # Already a dict (e.g., tool_result)
                    serialized_content.append(block)
            serialized.append({"role": role, "content": serialized_content})
        else:
            # Fallback: try to use as-is
            serialized.append({"role": role, "content": content})

    return serialized


def extract_sql_and_rows(messages: list) -> tuple[str | None, list[dict]]:
    """
    Walks the agent's message history to find the last run_query tool call
    and its result. Returns (sql, rows) or (None, []) if not found.
    Handles both Anthropic SDK objects and already-serialized dicts.
    """
    last_sql = None
    last_rows = []

    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue

        for block in content:
            # Handle Anthropic SDK tool_use object
            if hasattr(block, "type") and block.type == "tool_use" and block.name == "run_query":
                last_sql = block.input.get("sql")
            # Handle already-serialized dict (from follow-up history)
            elif isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "run_query":
                last_sql = block.get("input", {}).get("sql")

            # The user-role tool_result block contains the rows
            if isinstance(block, dict) and block.get("type") == "tool_result":
                try:
                    parsed = json.loads(block.get("content", "{}"))
                    if "rows" in parsed:
                        last_rows = parsed["rows"]
                except (json.JSONDecodeError, TypeError):
                    pass

    return last_sql, last_rows

def extract_chart_spec(messages: list) -> dict | None:
    """
    Walks the agent's message history to find a create_chart tool call.
    Returns the tool input dict (chart_type, x, y, title, color?) or None
    if the agent never called create_chart for this query.
    Handles both Anthropic SDK objects and already-serialized dicts.
    """
    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            # Handle Anthropic SDK tool_use object
            if (
                hasattr(block, "type")
                and block.type == "tool_use"
                and block.name == "create_chart"
            ):
                return block.input  # {"chart_type", "x", "y", "title", "color"?}
            # Handle already-serialized dict (from follow-up history)
            elif (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
                and block.get("name") == "create_chart"
            ):
                return block.get("input")
    return None


STATS_PROMPT = """You are generating 3 stat cards summarising a SQL query result for a UI dashboard.

User asked: {question}
SQL that ran: {sql}
First few rows: {rows_preview}
Total row count: {row_count}

Generate EXACTLY 3 stat cards as a JSON array. Each card has:
  - "label": short noun phrase (1-4 words), uppercase or title case
  - "value": short string (a number, percentage, status, or short phrase)
  - "color": one of "text-emerald-500" (good/positive), "text-rose-500" (warning/notable),
             "text-amber-500" (caution), or "text-foreground" (neutral)

Pick semantic insights, not just row counts. Examples:
- "TOP SPENDER" / "$221.55" / "text-emerald-500"
- "QUERY RESULTS" / "5 rows" / "text-foreground"
- "REVENUE TIER" / "Premium" / "text-amber-500"

Respond with ONLY the JSON array, no preamble, no markdown fences."""


def generate_stats(question: str, sql: str, rows: list[dict]) -> list[dict]:
    """
    Asks Claude to generate 3 stat cards. Returns a safe fallback on any failure
    so /ask never breaks just because stats generation hiccupped.
    """
    fallback = [
        {"label": "Rows returned", "value": str(len(rows)), "color": "text-foreground"},
        {"label": "Status", "value": "Complete", "color": "text-emerald-500"},
        {"label": "Source", "value": "SQL Whisper", "color": "text-foreground"},
    ]

    if not rows:
        return fallback

    try:
        rows_preview = json.dumps(rows[:3], cls=MySQLEncoder)
        prompt = STATS_PROMPT.format(
            question=question,
            sql=sql or "(unknown)",
            rows_preview=rows_preview,
            row_count=len(rows),
        )

        resp = anthropic_client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )

        text = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
        # Strip code fences if Claude added them despite instructions
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        stats = json.loads(text.strip())

        # Must be exactly 3 cards; pad or trim
        if len(stats) >= 3:
            return stats[:3]
        return stats + fallback[len(stats):]
    except Exception as e:
        print(f"WARN: stats generation failed: {e}")
        return fallback


def generate_summary(question: str) -> str:
    """Asks Claude to generate a 3-5 word summary of the user's question."""
    try:
        resp = anthropic_client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=15,
            system="Create a very short (2-4 word) descriptive title for this SQL query. Do not use quotes or introductory text. Return only the title.",
            messages=[{"role": "user", "content": question}],
        )
        return "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
    except Exception:
        return question[:30] + "..." if len(question) > 30 else question

@app.route("/ask", methods=["POST"])
def ask():
    """
    Natural-language question with multi-turn conversation memory.
    Caches single-turn results. Follow-ups always re-run.
    """
    connection_id = request.headers.get("X-Connection-Id")
    body = request.get_json() or {}
    question = (body.get("question") or "").strip()
    reset_conversation = body.get("reset", False)

    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400
    if not question:
        return jsonify({"error": "Missing question field"}), 400

    # Reset conversation if requested
    if reset_conversation:
        clear_conversation(connection_id)

    # Load prior conversation (may be empty)
    prior_history = get_conversation(connection_id)
    is_followup = len(prior_history) > 0

    try:
        # Run the agent with prior conversation context
        final_text, messages = run_agent(
            user_message=question,
            connection_id=connection_id,
            history=prior_history,
        )

        # Persist the updated conversation
        save_conversation(connection_id, messages)

        sql, rows = extract_sql_and_rows(messages)
        stats = generate_stats(question, sql, rows)

        # Save to history (best effort)
        save_query_history(
            connection_id=connection_id,
            text=question,
            data=rows,
            stats=stats,
        )

        result = {
            "text": question,
            "answer": final_text,
            "sql": sql,
            "data": rows,
            "stats": stats,
            "cached": False,
            "is_followup": is_followup,
        }

        return jsonify(result)
    except Exception as e:
        print(f"ERROR in /ask: {e}")
        return jsonify({"error": "Failed to process question", "detail": str(e)}), 500

@app.route("/conversation/reset", methods=["POST"])
def reset_conversation_endpoint():
    """Clear the conversation history for a connection."""
    connection_id = request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400
    clear_conversation(connection_id)
    return jsonify({"ok": True, "cleared": True})

# -------------------------------------------------------
# PUT /connections/<connection_id>
# Updates an existing connection's properties.
# -------------------------------------------------------
@app.route("/connections/<connection_id>", methods=["PUT"])
def update_connection(connection_id):
    if not connection_id:
        return jsonify({"error": "Missing connection_id"}), 400

    data = request.get_json() or {}

    # Check connection exists
    existing = fetch_creds_row(connection_id)
    if not existing:
        return jsonify({"error": "Connection not found"}), 404

    # Build update fields
    updates = []
    params = []

    if "name" in data:
        updates.append("name = ?")
        params.append(data["name"])
    if "host" in data:
        updates.append("host = ?")
        params.append(data["host"])
    if "port" in data:
        updates.append("port = ?")
        params.append(int(data["port"]))
    if "db_name" in data:
        updates.append("db_name = ?")
        params.append(data["db_name"])
    if "username" in data:
        updates.append("username = ?")
        params.append(data["username"])
    if "password" in data and data["password"]:
        password_enc = fernet.encrypt(data["password"].encode()).decode()
        updates.append("password_enc = ?")
        params.append(password_enc)
    if "db_type" in data:
        updates.append("db_type = ?")
        params.append(data["db_type"])

    if not updates:
        return jsonify({"error": "No fields to update"}), 400

    # Test new connection settings if credentials changed
    test_host = data.get("host", existing["host"])
    test_port = int(data.get("port", existing["port"]))
    test_user = data.get("username", existing["username"])
    test_pass = data.get("password") if data.get("password") else decrypt_password(existing["password_enc"])
    test_db = data.get("db_name", existing["db_name"])

    try:
        test_conn = pymysql.connect(
            host=test_host,
            port=test_port,
            user=test_user,
            password=test_pass,
            database=test_db,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5
        )
        with test_conn.cursor() as cursor:
            cursor.execute("SELECT 1")
        test_conn.close()
    except pymysql.OperationalError as e:
        return jsonify({"error": "Could not connect with new settings", "detail": str(e)}), 400

    # Update in database
    params.append(connection_id)
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        cursor.execute(
            f"UPDATE user_connections SET {', '.join(updates)} WHERE id = ?",
            tuple(params)
        )
        app_db.commit()
    finally:
        app_db.close()

    # Clear schema cache since connection may point to different DB
    schema_cache.pop(connection_id, None)

    return jsonify({"updated": True}), 200


# -------------------------------------------------------
# DELETE /connections/<connection_id>
# Removes credentials from TDSQL and clears the schema cache.
# Called by the frontend when the user disconnects.
# -------------------------------------------------------
@app.route("/connections/<connection_id>", methods=["DELETE"])
def delete_connection(connection_id):
    if not connection_id:
        return jsonify({"error": "Missing connection_id"}), 400

    # -------------------------------------------------------
    # Step 1: Remove credentials from TDSQL
    # This is the most important step — encrypted credentials
    # must not persist after the user disconnects.
    # -------------------------------------------------------
    app_db = get_app_db()
    try:
        cursor = app_db.cursor()
        if True:
            cursor.execute(
                "DELETE FROM user_connections WHERE id = ?",
                (connection_id,)
            )
            deleted = cursor.rowcount > 0
        app_db.commit()
    finally:
        app_db.close()

    if not deleted:
        return jsonify({"error": "Connection not found"}), 404

    # -------------------------------------------------------
    # Step 2: Evict the schema cache entry
    # The cache is keyed by connection_id. Once credentials
    # are gone the cache entry is stale and should not persist.
    # -------------------------------------------------------
    schema_cache.pop(connection_id, None)

    return jsonify({"deleted": True}), 200

@app.route("/tables", methods=["GET"])
def list_tables():
    """Returns the list of tables in the user's database for the sidebar."""
    connection_id = request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400
    
    conn = None
    try:
        conn = resolve_connection(connection_id)
        row = fetch_creds_row(connection_id)
        rows = fetch_information_schema(conn, row["db_name"])
        
        # Deduplicate table names (rows are per-column)
        table_names = sorted(set(r["TABLE_NAME"] for r in rows))
        
        # Get row count for each table (optional — adds visual richness)
        tables = []
        with conn.cursor() as cursor:
            for name in table_names:
                try:
                    cursor.execute(f"SELECT COUNT(*) AS c FROM `{name}`")
                    count = cursor.fetchone()["c"]
                except Exception:
                    count = None
                tables.append({"name": name, "row_count": count})
        
        return jsonify(tables)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": "Failed to list tables", "detail": str(e)}), 500
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    app.run(debug=True, port=5001)