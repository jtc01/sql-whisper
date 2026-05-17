import re

with open('app.py', 'r') as f:
    content = f.read()

# Replace pymysql.connect for get_app_db
new_db_func = """import sqlite3

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
"""

# We'll replace the existing get_app_db()
content = re.sub(r"def get_app_db\(\):.*?cursorclass=pymysql\.cursors\.DictCursor\n    \)", new_db_func, content, flags=re.DOTALL)

# Replace cursor execution in fetch_creds_row
content = content.replace("with app_db.cursor() as cursor:", "cursor = app_db.cursor()")
content = content.replace("cursor.fetchone()  # None if not found", "row = cursor.fetchone()\n            return dict(row) if row else None")

# We have to be careful with with app_db.cursor() because sqlite3 doesn't support with cursor as context manager.
# Actually, the simplest is to replace `with app_db.cursor() as cursor:` with `cursor = app_db.cursor()\n        if True:`
# Wait, `if True:` keeps the indentation.
content = content.replace("with app_db.cursor() as cursor:", "cursor = app_db.cursor()\n        if True:")

# MySQL uses %s, SQLite uses ?
# Let's manually fix the ? for get_app_db queries only.
def replace_params(match):
    return match.group(0).replace('%s', '?')

# Replace %s with ? in all execute statements
# We will just replace all %s with ? in the app_db queries.
# Luckily, the user_connection `open_user_connection` still uses pymysql for user queries!
# But user query execution doesn't use %s, it just executes formatted strings or the agent handles it.
# Actually fetch_information_schema uses %s. That's for the USER db (pymysql)! So it must stay %s!
# So we only replace %s in query_history and user_connections inserts/selects.
content = content.replace("WHERE id = %s", "WHERE id = ?")
content = content.replace("VALUES (%s, %s, %s, %s, %s)", "VALUES (?, ?, ?, ?, ?)")
content = content.replace("VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", "VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
content = content.replace("WHERE connection_id = %s", "WHERE connection_id = ?")
content = content.replace("LIMIT %s", "LIMIT ?")

# Also fix `cursor.rowcount` if needed, but it works in sqlite too.
# Fix fetchone and fetchall to return dicts instead of sqlite3.Row for JSON serialization
# We already set conn.row_factory = sqlite3.Row, but JSON needs dict.
# We can do `[dict(r) for r in rows]` instead of just `rows`.
content = content.replace("rows = cursor.fetchall()", "rows = [dict(r) for r in cursor.fetchall()]")

with open('app.py', 'w') as f:
    f.write(content)
print("Done")
