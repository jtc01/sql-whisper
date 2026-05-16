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
def get_app_db():
    return pymysql.connect(
        host=os.environ.get("APP_DB_HOST"),
        port=int(os.environ.get("APP_DB_PORT", 3306)),
        user=os.environ.get("APP_DB_USER"),
        password=os.environ.get("APP_DB_PASS"),
        database=os.environ.get("APP_DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor
    )

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
        with app_db.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, host, port, db_name, username, password_enc
                FROM user_connections
                WHERE id = %s
                LIMIT 1
                """,
                (connection_id,)
            )
            return cursor.fetchone()  # None if not found
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
) -> str | None:
    """
    Saves a query to history. Returns history_id or None on failure.
    Best-effort — never raises; history failures must not break a working query.

    Args:
        connection_id: which user DB this query is against
        text: the user's natural-language question
        data: query result rows (frontend's "data" field)
        stats: 3-item array of stat cards [{label, value, color}, ...]
    """
    try:
        history_id = str(uuid.uuid4())
        payload = json.dumps({"data": data, "stats": stats}, cls=MySQLEncoder)

        app_db = get_app_db()
        try:
            with app_db.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO query_history
                        (id, connection_id, name, prompt, response_payload)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (history_id, connection_id, None, text, payload),
                )
            app_db.commit()
            return history_id
        finally:
            app_db.close()
    except Exception as e:
        print(f"WARN: failed to save history: {e}")
        return None


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

# -------------------------------------------------------
# Step 2c: Cache layer (in-memory for hackathon)
# Swap schema_cache for COS/Redis in production
# -------------------------------------------------------
import time
 
schema_cache: dict = {}
CACHE_TTL = 300  # seconds (5 minutes)
 
def get_cached_schema(connection_id: str) -> str | None:
    entry = schema_cache.get(connection_id)
    if entry and (time.time() - entry["timestamp"]) < CACHE_TTL:
        return entry["schema"]
    return None
 
def set_cached_schema(connection_id: str, schema: str) -> None:
    schema_cache[connection_id] = {
        "schema":    schema,
        "timestamp": time.time()
    }

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

    password_enc = fernet.encrypt(data["password"].encode()).decode()
    connection_id = str(uuid.uuid4())

    app_db = get_app_db()
    try:
        with app_db.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO user_connections
                  (id, name, host, port, db_name, username, password_enc, db_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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

    return jsonify({"connection_id": connection_id})


# -------------------------------------------------------
# GET /connections — list saved connections (no passwords)
# -------------------------------------------------------
@app.route("/connections", methods=["GET"])
def list_connections():
    app_db = get_app_db()
    try:
        with app_db.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, host, port, db_name AS `database`, db_type AS type, created_at                
                FROM user_connections
                ORDER BY created_at DESC
                """
            )
            rows = cursor.fetchall()
            for r in rows:
                if r.get("created_at"):
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
        with app_db.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, connection_id, prompt, response_payload, created_at
                FROM query_history
                WHERE connection_id = %s
                ORDER BY created_at DESC
                    LIMIT %s
                """,
                (connection_id, limit),
            )
            rows = cursor.fetchall()
            result = []
            for r in rows:
                payload = r["response_payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                result.append({
                    "id": r["id"],
                    "connection_id": r["connection_id"],
                    "text": r["prompt"],
                    "created_at": r["created_at"].isoformat() + "Z" if r["created_at"] else None,
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
        with app_db.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, connection_id, prompt, response_payload, created_at
                FROM query_history
                WHERE id = %s LIMIT 1
                """,
                (history_id,),
            )
            r = cursor.fetchone()
            if not r:
                return jsonify({"error": "Not found"}), 404

            payload = r["response_payload"]
            if isinstance(payload, str):
                payload = json.loads(payload)

            return jsonify({
                "id": r["id"],
                "connection_id": r["connection_id"],
                "text": r["prompt"],
                "timestamp": r["created_at"].isoformat() if r["created_at"] else None,
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
        with app_db.cursor() as cursor:
            cursor.execute("DELETE FROM query_history WHERE id = %s", (history_id,))
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

if __name__ == "__main__":
    app.run(debug=True, port=5001)