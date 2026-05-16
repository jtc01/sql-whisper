import re
import json
from app import MySQLEncoder, get_cached_schema

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