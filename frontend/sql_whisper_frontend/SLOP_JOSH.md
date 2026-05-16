SQL WHISPERER — BACKEND API REFERENCE
app.py | Flask + pymysql + Fernet
======================================


OVERVIEW
--------
app.py is the Flask backend for SQL Whisperer. It acts as a secure
intermediary between the React frontend, the Claude AI agent, and
user-owned databases. No credentials are ever exposed to the frontend
or to the Claude context window — the backend handles all encryption,
connection management, query execution, and history persistence.

Responsibilities:
- Encrypts and stores user database credentials using Fernet symmetric encryption
- Validates credentials at connection time before storing anything
- Resolves a connection_id to a live database connection at request time
- Introspects and compresses database schemas for agent consumption
- Pre-warms the schema cache on connection so the first agent call is fast
- Executes agent-generated SQL safely with validation, row caps, and dual timeouts
- Persists query history so the frontend can replay previous results


ARCHITECTURE
------------
The system uses two separate databases:

  App DB (TDSQL)  — Stores encrypted user credentials and query history.
                    Owned by SQL Whisperer.
  User DB         — The database the user wants to query. Accessed
                    read-only at runtime via resolved credentials.

The agent never sees raw credentials. It passes a connection_id; the
backend resolves this to a live connection server-side.


ENVIRONMENT VARIABLES
---------------------
All sensitive configuration is read from environment variables via
python-dotenv. A .env file is required for local development.

  ENCRYPTION_KEY   Fernet key for password encryption.
                   Generate with: Fernet.generate_key()
  APP_DB_HOST      Hostname of the app's own TDSQL instance
  APP_DB_PORT      Port for the app DB (default: 3306)
  APP_DB_USER      Username for the app DB
  APP_DB_PASS      Password for the app DB
  APP_DB_NAME      Database name for the app DB


CORE MODULES
------------

-- Credential Resolution --

fetch_creds_row(connection_id)
  Looks up an encrypted credentials row in the app DB by connection_id.
  Returns the raw dict (password still encrypted) or None if not found.

decrypt_password(password_enc)
  Decrypts a Fernet-encrypted password string back to plaintext.
  The encrypted value is stored as a UTF-8 string in TDSQL.

open_user_connection(creds)
  Opens a live pymysql connection to the user's database using decrypted
  credentials. Sets connect_timeout=5 so unreachable hosts fail fast.

resolve_connection(connection_id)                        [public entry point]
  Composes all three steps above in a single call.
  Raises ValueError if connection_id not found.
  Raises pymysql.OperationalError if DB is unreachable.

  row      = fetch_creds_row(connection_id)
  password = decrypt_password(row['password_enc'])
  conn     = open_user_connection({...password...})


-- Schema Pipeline --

fetch_information_schema(conn, db_name)
  Queries INFORMATION_SCHEMA.COLUMNS and KEY_COLUMN_USAGE to retrieve
  table structure, column types, nullability, PKs, and FK relationships.
  No user data rows are read at any point.

compress_schema(rows)
  Transforms raw INFORMATION_SCHEMA rows into a compact one-line-per-table
  format, reducing schema size by 5-10x vs raw SHOW CREATE TABLE output.

  Example output:
    customers(id int [PK, NOT NULL], email varchar [NOT NULL], country varchar)
    invoices(id int [PK], customer_id int [FK->customers.id], total decimal)

get_cached_schema(connection_id)
  Returns the cached schema string or None if expired (TTL: 5 minutes).

set_cached_schema(connection_id, schema)
  Stores schema with current timestamp. In production, swap the
  in-memory dict for COS or Redis.


-- Table List Pipeline --

TABLE_LIST_QUERY
  Queries INFORMATION_SCHEMA.TABLES for all BASE TABLEs in the database.
  Returns table name and estimated row count (TABLE_ROWS) per table.
  Filters out views. Note: TABLE_ROWS is an InnoDB estimate, not an
  exact count — suitable for display only, never for query logic.

fetch_table_list(conn, db_name)
  Executes TABLE_LIST_QUERY and returns a list of dicts with table_name
  and row_count for every base table in the database.


-- Query Pipeline --

Always call run_query_pipeline() — never call individual steps directly.

clean_sql(sql)
  Strips -- single-line and /* multi-line */ comments, then normalises
  whitespace. Runs before validation so comments can't hide malicious tokens.

validate_sql(sql)
  Enforces three safety rules on the cleaned SQL:
  1. First token must be SELECT (rejects INSERT, UPDATE, DELETE, DROP, etc.)
  2. No stacked statements — no semicolons inside the query body
  3. Empty strings are rejected
  Raises ValueError with a human-readable message on failure.

apply_row_cap(sql)
  Appends LIMIT 501 if no LIMIT clause is present. Fetches ROW_CAP + 1
  rows so truncation can be detected without pulling the full result set.
  Existing LIMIT clauses are respected.

execute_query(conn, sql)
  Executes the validated, capped SQL. Sets MAX_EXECUTION_TIME=5000
  server-side before running. Returns:
    {
      "columns":   ["id", "name", "total"],
      "rows":      [{...}, ...],
      "row_count": 42,
      "truncated": false
    }

execute_query_with_timeout(conn, sql)
  Wraps execute_query() in a daemon thread with a client-side timeout.
  Two layers work together:
  - Client-side (threading.Timer): catches network hangs and unresponsive hosts
  - Server-side (MAX_EXECUTION_TIME): kills slow queries already on the DB
  Raises TimeoutError if client-side fires; pymysql.OperationalError if server-side fires.

MySQLEncoder
  Custom json.JSONEncoder subclass for non-serialisable pymysql types:
    Decimal       -> float  (monetary / numeric columns)
    datetime/date -> ISO 8601 string

serialise_result(result)
  Round-trips the result dict through json.dumps (MySQLEncoder) then
  json.loads, producing a plain dict with only JSON-native types.

build_response(serialised, sql)
  Wraps the serialised result in a response envelope with the executed SQL
  and a truncated flag. The truncated flag tells the agent to caveat its
  answer when the full result set was not returned.

run_query_pipeline(conn, raw_sql)                        [public entry point]
  Composes all steps in order:
    clean_sql()                   # strip comments
    validate_sql()                # allowlist + stacked statement check
    apply_row_cap()               # inject LIMIT if absent
    execute_query_with_timeout()  # run with dual timeouts
    serialise_result()            # convert MySQL types to JSON-safe types
    build_response()              # wrap in response envelope


-- History --

save_query_history(connection_id, text, data, stats)
  Persists a query result to the query_history table. Best-effort — never
  raises; history failures must not break a working query.
  Returns history_id on success, None on failure.


API ENDPOINTS
-------------
All endpoints that operate on a user database expect the connection_id
passed as an X-Connection-Id request header.


POST /connections
  Validates credentials against the live database, then encrypts the
  password and stores the connection. Pre-warms the schema cache on
  success so the first agent call does not cold-fetch the schema.
  Returns a connection_id UUID for all subsequent requests.

  Validation steps (in order):
    1. Check all required fields are present
    2. Attempt a live connection with submitted credentials
    3. Run SELECT 1 to confirm the connection works
    4. Encrypt password and write to app DB
    5. Pre-warm schema cache (non-fatal if this step fails)

  Request body (JSON):
    name       string   required   Human-readable label
    host       string   required   Hostname or IP of the user's database
    db_name    string   required   Name of the database to connect to
    username   string   required   Database username
    password   string   required   Database password — encrypted before storage
    port       integer  optional   Database port (default: 3306)
    db_type    string   optional   Engine type (default: mysql)

  Responses:
    200   { connection_id: string }
    400   Missing required fields, or credentials failed validation


DELETE /connections/<connection_id>
  Removes a stored connection. Deletes encrypted credentials from the
  app DB and evicts the schema cache entry for the connection.
  Credentials are deleted first; cache eviction is best-effort.

  Responses:
    200   { deleted: true }
    404   connection_id does not exist


GET /connections
  Lists all saved connections. Passwords are never included.

  Responses:
    200   Array of { id, name, host, port, database, type, created_at, status }


POST /connections/<connection_id>/test
  Verifies a stored connection is still reachable by running SELECT 1.
  Called by the frontend on page focus and on a polling interval.

  Responses:
    200   { ok: true }
    404   { ok: false, error } — connection_id does not exist
    503   { ok: false, error } — DB unreachable or credentials invalid


GET /tables
  Returns a list of all base tables in the connected database, with
  estimated row counts. Used by the frontend immediately after /connect
  to display which tables were detected. Cheaper than /schema — no
  column detail is fetched. Independent of the schema cache.

  Note: row counts are InnoDB estimates from INFORMATION_SCHEMA.TABLES,
  not exact counts. Suitable for display only.

  Headers:
    X-Connection-Id   string   required

  Responses:
    200   { tables: [{ table_name, row_count }], table_count: integer }
    400   Missing X-Connection-Id header
    404   connection_id does not exist
    503   Could not connect to the user's database


GET /schema
  Returns the compressed schema. Checks cache first (5-min TTL).
  On a cache miss, introspects INFORMATION_SCHEMA, compresses, and caches.

  Headers:
    X-Connection-Id   string   required

  Responses:
    200   { schema: string, cached: boolean }
    200   { error: "No tables found in database" }
    400   Missing X-Connection-Id header
    404   connection_id does not exist
    503   Could not connect to the user's database
    500   INFORMATION_SCHEMA query failed


GET /sample/<table_name>
  Returns up to 5 sample rows from a named table. Used by the agent to
  understand data shape without running an analytical query. Schema must
  be cached (GET /schema must have been called first).

  Headers:
    X-Connection-Id   string   required

  URL params:
    table_name   string   required   Must match ^[a-zA-Z0-9_]+$

  Responses:
    200   { table, columns, rows, row_count }
    400   Missing header / invalid table name / table not in schema / schema not cached
    503   Could not connect to the user's database


POST /query
  Executes a SQL query via the full query pipeline. Only SELECT permitted.

  Headers:
    X-Connection-Id   string   required

  Request body (JSON):
    sql   string   required   A SELECT statement. Comments stripped before validation.

  Responses:
    200   { sql, columns, rows, row_count, truncated }
          truncated is true when >500 rows matched the query
    400   Missing header / empty SQL / non-SELECT / stacked statements
    422   SQL syntax error — detail field contains the MySQL error
    503   Database connection error
    504   Query did not respond within 5 seconds


GET /history
  Returns recent query history entries for a connection, newest first.

  Query params:
    connection_id   string   required   (or pass via X-Connection-Id header)
    limit           integer  optional   Defaults to 20, max 100

  Responses:
    200   Array of { id, connection_id, text, created_at, data, stats }
    400   Missing connection_id


GET /history/<history_id>
  Returns a single history entry by UUID.

  Responses:
    200   { id, connection_id, text, timestamp, data, stats }
    404   history_id does not exist


DELETE /history/<history_id>
  Deletes a single history entry.

  Responses:
    200   { deleted: boolean }


SECURITY MODEL
--------------

Credential isolation:
  - Passwords are encrypted with Fernet (AES-128-CBC + HMAC-SHA256)
    before being written to the app DB
  - Credentials are validated against the live database before storage —
    invalid credentials are rejected at the boundary, never persisted
  - ENCRYPTION_KEY is read from an environment variable — never hardcoded
  - The frontend receives only a connection_id UUID
  - The Claude agent receives only the connection_id — credentials never
    appear in the prompt or message history
  - On disconnect, credentials are deleted from the app DB and the schema
    cache entry is evicted

SQL injection prevention:
  - Table names in URL parameters are validated against ^[a-zA-Z0-9_]+$
  - All parameterised queries use pymysql %s placeholders
  - The only interpolated user value is the table name in GET /sample,
    which passes the allowlist regex and is wrapped in backticks:
    SELECT * FROM `{table_name}`

Query safety:
  - Only SELECT statements permitted — enforced at the Python level
  - Comments stripped before validation
  - Stacked statements rejected
  - Results capped at 500 rows
  - Dual-timeout system prevents runaway queries blocking workers


APP DATABASE SCHEMA
-------------------

CREATE TABLE user_connections (
  id           CHAR(36)     PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  host         VARCHAR(255) NOT NULL,
  port         INT          NOT NULL DEFAULT 3306,
  db_name      VARCHAR(255) NOT NULL,
  username     VARCHAR(255) NOT NULL,
  password_enc TEXT         NOT NULL,
  db_type      VARCHAR(50)  NOT NULL DEFAULT 'mysql',
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE query_history (
  id               CHAR(36)   PRIMARY KEY,
  connection_id    CHAR(36)   NOT NULL,
  name             VARCHAR(255),
  prompt           TEXT       NOT NULL,
  response_payload JSON       NOT NULL,
  created_at       TIMESTAMP  DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES user_connections(id)
);


CONSTANTS
---------
  ROW_CAP        500    Maximum rows returned by /query before truncation
  CACHE_TTL      300s   Schema cache time-to-live
  QUERY_TIMEOUT  5s     Client-side and server-side query timeout
  SAMPLE_SIZE    5      Rows returned by GET /sample


DEPENDENCIES
------------
  flask            Web framework and routing
  flask-cors       CORS headers for the React frontend
  pymysql          MySQL / TDSQL driver
  cryptography     Fernet symmetric encryption
  python-dotenv    Loads .env in development

  pip install flask flask-cors pymysql cryptography python-dotenv


RUNNING LOCALLY
---------------
  # 1. Generate an encryption key (run once, save to .env)
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

  # 2. Create .env with all required environment variables

  # 3. Start the development server
  python app.py   # listens on http://localhost:5001

  # Production
  gunicorn -w 4 -b 0.0.0.0:5001 app:app