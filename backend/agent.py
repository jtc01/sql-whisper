import os
import json
import time
import anthropic
import requests


# -------------------------------------------------------
# Anthropic client
# -------------------------------------------------------
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"

# Retry configuration for transient API errors
MAX_RETRIES = 3
RETRY_DELAY_BASE = 2  # seconds, will be multiplied by attempt number
# -------------------------------------------------------
# System prompt
# Tells Claude its role, what tools it has, and how to
# behave — especially around truncation and uncertainty
# -------------------------------------------------------
SYSTEM_PROMPT = """
You are a SQL analyst assistant. Your job is to answer the user's questions
about their database by writing and executing SQL queries, then explaining
the results clearly in plain language.

You have access to four tools:

1. get_schema    — call this FIRST at the start of every conversation to
                   understand the database structure before writing any SQL.

2. get_sample    — call this when you need to understand the actual format or
                   values in a specific table before writing a query. For example,
                   use it to check date formats, enum values, or string casing
                   before filtering. Returns 5 sample rows.

3. run_query     — call this to execute a SELECT query and get results back.
                   You will receive the rows, column names, and a flag
                   indicating whether the results were truncated at 500 rows.

4. create_chart  — call this after run_query when the user asks for a chart or
                   visualisation. Pass the column names to use for the axes and
                   the chart type. The frontend will handle rendering.

Rules you must always follow:
- Always call get_schema before your first run_query in a conversation.
- Use get_sample when you are unsure about data formats or values in a column
  before writing a query that filters or groups by that column.
- Only write SELECT statements. Never attempt INSERT, UPDATE, DELETE, or DROP.
- If results are truncated (truncated: true), always tell the user that your
  answer is based on the first 500 rows and may not reflect the full dataset.
- If a question cannot be answered with the available schema, say so clearly
  rather than guessing.
- When returning numbers from financial columns, format them clearly
  (e.g. $1,234.56 not 1234.5600000001).
- When the user asks for a chart or visualisation, you MUST call create_chart.
  Never describe a chart in plain text as a substitute for calling the tool.
- Never mention create_chart, chart specs, or chart parameters in plain text.
  The only way to produce a chart is by calling the create_chart tool.
- Before calling create_chart, verify the data suits the chart type. A pie chart
  requires a categorical column and a single numeric column. A line chart requires
  an ordered x-axis (e.g. dates or sequential values). A scatter chart requires
  two independent numeric columns. If the data does not fit, tell the user why
  and suggest the most appropriate alternative instead.
- Unless the user specifies otherwise, choose chart settings that are visually
  appealing: write descriptive titles, use the color column to add grouping where
  it makes the data clearer, and prefer grouped charts over plotting raw IDs or
  keys on an axis.
""".strip()

# -------------------------------------------------------
# Tool definitions
# These tell Claude what each tool does, what parameters
# it takes, and which parameters are required.
# Claude uses these to decide when and how to call them.
# -------------------------------------------------------
TOOLS = [
    {
        "name": "get_schema",
        "description": (
            "Retrieves the full database schema for the connected database. "
            "Returns a compressed, human-readable summary of every table, "
            "including column names, data types, primary keys, foreign keys, "
            "and NOT NULL constraints. "
            "Call this at the start of every conversation before writing any SQL, "
            "so you understand the structure of the database you are querying."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},       # no parameters — connection_id comes from the header
            "required": []
        }
    },
    {
        "name": "run_query",
        "description": (
            "Executes a read-only SELECT query against the user's database and "
            "returns the results as a list of rows with column names. "
            "Results are capped at 500 rows. If the result set exceeds 500 rows "
            "the response will include truncated: true — you must tell the user "
            "when this happens. "
            "Only SELECT statements are permitted. Any other statement type will "
            "be rejected. Do not include semicolons in the middle of the query. "
            "If the user asks for a specific number of results (e.g., 'the first actor', 'top 5 customers'), "
            "you MUST include an appropriate LIMIT clause in your SQL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": (
                        "A valid SQL SELECT statement to execute against the database. "
                        "Must be a single SELECT statement. No INSERT, UPDATE, DELETE, "
                        "DROP, or stacked statements. Include a LIMIT clause if the user "
                        "request implies one (e.g. 'first', 'top n')."
                    )
                }
            },
            "required": ["sql"]
        }
    },
    {
        "name": "get_sample",
        "description": (
            "Returns 5 sample rows from a single table in the user's database. "
            "Use this when you need to inspect the actual values in a table before "
            "writing a query — for example, to check date formats, see what values "
            "an enum column contains, verify string casing (e.g. 'USA' vs 'United States'), "
            "or understand how a foreign key column relates to another table. "
            "Do not use this as a substitute for run_query when the user wants real results. "
            "Only use it to inform how you write a subsequent query."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table_name": {
                    "type": "string",
                    "description": (
                        "The exact name of the table to sample. Must match a table "
                        "name returned by get_schema. Only alphanumeric characters "
                        "and underscores are permitted."
                    )
                }
            },
            "required": ["table_name"]
        }
    },
    {
        "name": "create_chart",
        "description": (
            "Call this when the user asks for a chart or visualisation. "
            "Use run_query first to get the data, then call this tool to "
            "specify how it should be charted. The frontend will render it. "
            "For pie charts, x is the column containing slice labels (categories) "
            "and y is the column containing numeric slice values."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "chart_type": {
                    "type": "string",
                    "enum": ["bar", "line", "pie", "scatter"],
                    "description": "The type of chart to render."
                },
                "x": {
                    "type": "string",
                    "description": (
                        "Column for the x-axis (bar, line, scatter), "
                        "or the column containing slice labels for pie charts "
                        "(e.g. a category or name column)."
                    )
                },
                "y": {
                    "type": "string",
                    "description": (
                        "Column for the y-axis (bar, line, scatter), "
                        "or the column containing numeric slice sizes for pie charts "
                        "(e.g. a revenue or count column)."
                    )
                },
                "color": {
                    "type": "string",
                    "description": "Optional column to group/color by. Used by bar, line, and scatter only."
                },
                "title": {
                    "type": "string",
                    "description": "Chart title."
                }
            },
            "required": ["chart_type", "x", "y", "title"]
        }
    }
]

# -------------------------------------------------------
# Tool executor
# Receives a tool_use block from Claude, calls the correct
# Flask endpoint, and returns the result as a string.
# In production this calls your Flask API over HTTP.
# -------------------------------------------------------

FLASK_BASE_URL = os.environ.get("FLASK_BASE_URL", "http://localhost:5001")

def execute_tool(tool_name: str, tool_input: dict, connection_id: str) -> str:
    """
    Routes a tool call from Claude to the correct Flask endpoint.
    Returns the result as a JSON string — Claude receives this as
    the tool_result content and uses it to form its next response.

    Args:
      tool_name     - "get_schema" or "run_query"
      tool_input    - the dict Claude passed as the tool's input
      connection_id - the session's connection ID, injected as a header

    Returns:
      A JSON string of the endpoint response.
      On HTTP error, returns a JSON error string so Claude can
      report the failure gracefully rather than crashing.
    """
    headers = {"X-Connection-Id": connection_id}

    try:
        if tool_name == "get_schema":
            response = requests.get(
                f"{FLASK_BASE_URL}/schema",
                headers=headers,
                timeout=10
            )

        elif tool_name == "run_query":
            response = requests.post(
                f"{FLASK_BASE_URL}/query",
                headers=headers,
                json={"sql": tool_input["sql"]},
                timeout=15        # slightly longer — query may take a moment
            )
            # ── Error feedback loop ──────────────────────────────────────────
            # On a query failure, return a structured error message that tells
            # the agent exactly what went wrong and instructs it to fix and
            # retry. The agent receives this as a tool_result and will
            # naturally rewrite the SQL in its next turn.
            #
            # We handle two cases separately because they need different guidance:
            #   422 ProgrammingError — bad column/table name, fixable by the agent
            #   503 OperationalError — DB connection issue, not fixable by the agent
            # ────────────────────────────────────────────────────────────────
            if response.status_code == 422:
                body = response.json()
                detail = body.get("detail", body.get("error", "Unknown SQL error"))
                return json.dumps({
                    "error": "query_failed",
                    "message": (
                        f"The query failed with this error: {detail}. "
                        "This is likely a wrong column or table name. "
                        "Check the schema carefully and rewrite the SQL with the correct names."
                    )
                })

            if not response.ok:
                body = response.json()
                detail = body.get("detail", body.get("error", "Unknown error"))
                return json.dumps({
                    "error": "query_failed",
                    "message": f"The query failed with this error: {detail}."
                })

            return json.dumps(response.json())
        
        elif tool_name == "get_sample":
            response = requests.get(
                f"{FLASK_BASE_URL}/sample/{tool_input['table_name']}",
                headers=headers,
                timeout=10
            )
        elif tool_name == "create_chart":
            return json.dumps({"status": "ok", "message": "Chart spec received by frontend."})
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        return json.dumps(response.json())

    except requests.exceptions.Timeout:
        return json.dumps({"error": "Request to Flask backend timed out."})
    except requests.exceptions.ConnectionError:
        return json.dumps({"error": "Could not reach Flask backend."})


# -------------------------------------------------------
# Retry wrapper for Anthropic API calls
# Handles transient errors like 529 (overloaded) with
# exponential backoff
# -------------------------------------------------------
def call_anthropic_with_retry(messages: list[dict]) -> anthropic.types.Message:
    """
    Wraps the Anthropic API call with retry logic for transient errors.
    Retries on 529 (overloaded), 500, 502, 503, 504 errors.
    Uses exponential backoff between retries.
    """
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages
            )
        except anthropic.APIStatusError as e:
            last_error = e
            # Retry on overloaded (529) and server errors (5xx)
            if e.status_code in (429, 500, 502, 503, 504, 529):
                if attempt < MAX_RETRIES:
                    delay = RETRY_DELAY_BASE * attempt
                    print(f"[agent] API error {e.status_code}, retrying in {delay}s (attempt {attempt}/{MAX_RETRIES})")
                    time.sleep(delay)
                    continue
            # Non-retryable error, raise immediately
            raise
        except anthropic.APIConnectionError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                delay = RETRY_DELAY_BASE * attempt
                print(f"[agent] Connection error, retrying in {delay}s (attempt {attempt}/{MAX_RETRIES})")
                time.sleep(delay)
                continue
            raise

    # All retries exhausted
    raise last_error


# -------------------------------------------------------
# Agentic loop
# Sends the conversation to Claude, handles tool calls
# in a loop until Claude produces a final text response,
# then returns that response to the caller.
# -------------------------------------------------------
def run_agent(user_message: str, connection_id: str, history: list[dict]) -> tuple[str, list[dict]]:
    """
    Runs one turn of the agent loop.

    Claude may call tools zero or more times before producing its final
    text answer. Each tool call is executed by execute_tool(), and the
    result is fed back into the conversation. This continues until
    Claude sets stop_reason to "end_turn" rather than "tool_use".

    Args:
      user_message  - the user's latest message
      connection_id - used to route tool calls to the right database
      history       - the full prior conversation as a list of message dicts
                      (each with "role" and "content" keys)

    Returns:
      A tuple of:
        - final_text  : Claude's plain-language answer as a string
        - history     : the updated conversation history including this turn,
                        ready to be stored and passed back on the next call
    """
    # append the new user message to history
    messages = history + [{"role": "user", "content": user_message}]

    while True:
        response = call_anthropic_with_retry(messages)

        # append Claude's response to the running message history
        messages.append({"role": "assistant", "content": response.content})

        # if Claude is done (no tool calls), extract and return the text
        if response.stop_reason == "end_turn":
            final_text = " ".join(
                block.text
                for block in response.content
                if hasattr(block, "text")
            )
            return final_text, messages

        # otherwise, handle each tool_use block Claude requested
        if response.stop_reason == "tool_use":
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                # execute the tool and get back a result string
                result_str = execute_tool(
                    tool_name=block.name,
                    tool_input=block.input,
                    connection_id=connection_id
                )

                # package the result in the format Claude expects
                tool_results.append({
                    "type":        "tool_result",
                    "tool_use_id": block.id,   # must match the id Claude sent
                    "content":     result_str
                })

            # feed all tool results back to Claude as a user message
            # (this is how the Anthropic API expects tool results to be returned)
            messages.append({"role": "user", "content": tool_results})

            # loop continues — Claude will now process the tool results
            # and either call more tools or produce its final answer