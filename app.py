import os
import pymysql
from flask import Flask, request, jsonify
from cryptography.fernet import Fernet

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
            cursor.exWecute(
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
# Example: how resolve_connection is used inside an endpoint
# -------------------------------------------------------
@app.route("/schema", methods=["GET"])
def get_schema():
    connection_id = request.headers.get("X-Connection-Id")
    if not connection_id:
        return jsonify({"error": "Missing X-Connection-Id header"}), 400

    try:
        conn = resolve_connection(connection_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except pymysql.OperationalError as e:
        return jsonify({"error": "Could not connect to database", "detail": str(e)}), 503

    # conn is now a live pymysql connection to the user's DB
    # ... proceed with INFORMATION_SCHEMA query in next step
    conn.close()
    return jsonify({"status": "connection resolved successfully"})