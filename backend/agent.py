import os
import json
import anthropic
import requests


# -------------------------------------------------------
# Anthropic client
# -------------------------------------------------------
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"
# -------------------------------------------------------
# System prompt
# Tells Claude its role, what tools it has, and how to
# behave — especially around truncation and uncertainty
# -------------------------------------------------------
SYSTEM_PROMPT = """
You are a SQL analyst assistant. Your job is to answer the user's questions
about their database by writing and executing SQL queries, then explaining
the results clearly in plain language.

You have access to two tools:

1. get_schema  — call this FIRST at the start of every conversation to
                 understand the database structure before writing any SQL.

2. run_query   — call this to execute a SELECT query and get results back.
                 You will receive the rows, column names, and a flag
                 indicating whether the results were truncated at 500 rows.

Rules you must always follow:
- Always call get_schema before your first run_query in a conversation.
- Only write SELECT statements. Never attempt INSERT, UPDATE, DELETE, or DROP.
- If results are truncated (truncated: true), always tell the user that your
  answer is based on the first 500 rows and may not reflect the full dataset.
- If a question cannot be answered with the available schema, say so clearly
  rather than guessing.
- When returning numbers from financial columns, format them clearly
  (e.g. $1,234.56 not 1234.5600000001).
- If the user asks for a chart or visualisation, return the data in your
  response with a clear structure — the frontend will handle rendering.
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
            "be rejected. Do not include semicolons in the middle of the query."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": (
                        "A valid SQL SELECT statement to execute against the database. "
                        "Must be a single SELECT statement. No INSERT, UPDATE, DELETE, "
                        "DROP, or stacked statements. Do not include a LIMIT clause — "
                        "one will be added automatically."
                    )
                }
            },
            "required": ["sql"]
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

        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        return json.dumps(response.json())

    except requests.exceptions.Timeout:
        return json.dumps({"error": "Request to Flask backend timed out."})
    except requests.exceptions.ConnectionError:
        return json.dumps({"error": "Could not reach Flask backend."})


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
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages
        )

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