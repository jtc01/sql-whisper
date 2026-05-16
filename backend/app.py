import os
import pymysql
from flask import Flask, request, jsonify
from cryptography.fernet import Fernet
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)

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
                SELECT id, name, host, port, db_name, db_type, created_at
                FROM user_connections
                ORDER BY created_at DESC
                """
            )
            rows = cursor.fetchall()
            for r in rows:
                if r.get("created_at"):
                    r["created_at"] = r["created_at"].isoformat()
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


if __name__ == "__main__":
    app.run(debug=True, port=5001)