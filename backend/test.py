import json
import unittest
from unittest.mock import patch, MagicMock

from agent import TOOLS, SYSTEM_PROMPT, execute_tool, run_agent

# -------------------------------------------------------
# Layer 1: Unit tests — no network, no Claude, no Flask
# -------------------------------------------------------
class TestToolDefinitions(unittest.TestCase):
    """Verify tool schemas are correctly structured before
    sending them to the Claude API."""

    def test_two_tools_defined(self):
        self.assertEqual(len(TOOLS), 2)

    def test_tool_names(self):
        names = [t["name"] for t in TOOLS]
        self.assertIn("get_schema", names)
        self.assertIn("run_query", names)

    def test_get_schema_has_no_required_params(self):
        schema = next(t for t in TOOLS if t["name"] == "get_schema")
        self.assertEqual(schema["input_schema"]["required"], [])

    def test_run_query_requires_sql(self):
        schema = next(t for t in TOOLS if t["name"] == "run_query")
        self.assertIn("sql", schema["input_schema"]["required"])
        self.assertIn("sql", schema["input_schema"]["properties"])

    def test_all_tools_have_descriptions(self):
        for tool in TOOLS:
            self.assertIn("description", tool)
            self.assertTrue(len(tool["description"]) > 0)

    def test_system_prompt_mentions_get_schema_first(self):
        # Claude must be instructed to call get_schema before run_query
        prompt_lower = SYSTEM_PROMPT.lower()
        self.assertIn("get_schema", prompt_lower)
        self.assertIn("truncated", prompt_lower)


class TestExecuteTool(unittest.TestCase):
    """Verify execute_tool routes correctly and handles
    errors gracefully — all HTTP calls are mocked."""

    CONNECTION_ID = "test-connection-uuid-123"

    @patch("agent.requests.get")
    def test_get_schema_calls_correct_endpoint(self, mock_get):
        mock_get.return_value.json.return_value = {"schema": "orders(id int [PK])"}
        mock_get.return_value.status_code = 200

        result = execute_tool("get_schema", {}, self.CONNECTION_ID)

        # verify the right URL was called
        mock_get.assert_called_once()
        call_url = mock_get.call_args[0][0]
        self.assertIn("/schema", call_url)

        # verify connection_id was sent as a header, not in the body
        call_headers = mock_get.call_args[1]["headers"]
        self.assertEqual(call_headers["X-Connection-Id"], self.CONNECTION_ID)

        # verify result is a JSON string containing the schema
        parsed = json.loads(result)
        self.assertIn("schema", parsed)

    @patch("agent.requests.post")
    def test_run_query_calls_correct_endpoint(self, mock_post):
        mock_post.return_value.json.return_value = {
            "columns": ["id", "total"],
            "rows": [{"id": 1, "total": 9.99}],
            "row_count": 1,
            "truncated": False
        }
        mock_post.return_value.status_code = 200

        sql = "SELECT id, total FROM invoices"
        result = execute_tool("run_query", {"sql": sql}, self.CONNECTION_ID)

        # verify POST was called to /query
        mock_post.assert_called_once()
        call_url = mock_post.call_args[0][0]
        self.assertIn("/query", call_url)

        # verify sql was sent in the request body
        call_json = mock_post.call_args[1]["json"]
        self.assertEqual(call_json["sql"], sql)

        # verify result is parseable and contains rows
        parsed = json.loads(result)
        self.assertIn("rows", parsed)

    @patch("agent.requests.get")
    def test_execute_tool_handles_timeout(self, mock_get):
        import requests as req
        mock_get.side_effect = req.exceptions.Timeout

        result = execute_tool("get_schema", {}, self.CONNECTION_ID)
        parsed = json.loads(result)

        self.assertIn("error", parsed)
        self.assertIn("timed out", parsed["error"].lower())

    @patch("agent.requests.get")
    def test_execute_tool_handles_connection_error(self, mock_get):
        import requests as req
        mock_get.side_effect = req.exceptions.ConnectionError

        result = execute_tool("get_schema", {}, self.CONNECTION_ID)
        parsed = json.loads(result)

        self.assertIn("error", parsed)

    def test_execute_tool_unknown_tool_returns_error(self):
        result = execute_tool("drop_table", {}, self.CONNECTION_ID)
        parsed = json.loads(result)
        self.assertIn("error", parsed)


# -------------------------------------------------------
# Layer 2: Integration test — mock Claude, real execute_tool
# Verifies the agentic loop handles tool calls correctly
# without making real Anthropic API calls
# -------------------------------------------------------
class TestAgentLoop(unittest.TestCase):
    """Tests the run_agent loop logic by mocking the Anthropic
    client. Claude's responses are simulated so we can test
    multi-step tool call sequences deterministically."""

    CONNECTION_ID = "test-connection-uuid-123"

    def _make_text_block(self, text: str):
        """Simulate a Claude text response block."""
        block = MagicMock()
        block.type = "text"
        block.text = text
        return block

    def _make_tool_use_block(self, tool_id: str, name: str, input_dict: dict):
        """Simulate a Claude tool_use block."""
        block = MagicMock()
        block.type = "tool_use"
        block.id = tool_id
        block.name = name
        block.input = input_dict
        return block

    def _make_response(self, stop_reason: str, content: list):
        """Simulate a full Claude API response."""
        response = MagicMock()
        response.stop_reason = stop_reason
        response.content = content
        return response

    @patch("agent.requests.post")
    @patch("agent.requests.get")
    @patch("agent.client.messages.create")
    def test_agent_calls_get_schema_then_run_query_then_answers(
        self, mock_create, mock_get, mock_post
    ):
        """
        Simulates the typical happy path:
          Turn 1: Claude calls get_schema
          Turn 2: Claude calls run_query
          Turn 3: Claude returns a text answer
        Verifies the loop completes and returns the final text.
        """
        # mock Flask /schema endpoint
        mock_get.return_value.json.return_value = {
            "schema": "invoices(id int [PK], total decimal, created_at datetime)"
        }

        # mock Flask /query endpoint
        mock_post.return_value.json.return_value = {
            "columns": ["total"],
            "rows": [{"total": 1234.56}],
            "row_count": 1,
            "truncated": False,
            "sql": "SELECT SUM(total) AS total FROM invoices LIMIT 501"
        }

        # simulate Claude's three-turn sequence
        mock_create.side_effect = [
            # turn 1: Claude calls get_schema
            self._make_response("tool_use", [
                self._make_tool_use_block("tool_1", "get_schema", {})
            ]),
            # turn 2: Claude calls run_query after seeing the schema
            self._make_response("tool_use", [
                self._make_tool_use_block("tool_2", "run_query", {
                    "sql": "SELECT SUM(total) AS total FROM invoices"
                })
            ]),
            # turn 3: Claude produces its final answer
            self._make_response("end_turn", [
                self._make_text_block("The total revenue is $1,234.56.")
            ])
        ]

        answer, history = run_agent(
            user_message="What is the total revenue?",
            connection_id=self.CONNECTION_ID,
            history=[]
        )

        # Claude should have been called three times
        self.assertEqual(mock_create.call_count, 3)

        # final answer should be the text Claude returned on turn 3
        self.assertEqual(answer, "The total revenue is $1,234.56.")

        # history should contain all turns for the next conversation round
        self.assertTrue(len(history) > 0)

    @patch("agent.requests.get")
    @patch("agent.client.messages.create")
    def test_agent_returns_immediately_on_end_turn(self, mock_create, mock_get):
        """If Claude answers without calling any tools, the loop
        should return after exactly one API call."""
        mock_create.return_value = self._make_response("end_turn", [
            self._make_text_block("I can help you query your database.")
        ])

        answer, history = run_agent(
            user_message="Hello, what can you do?",
            connection_id=self.CONNECTION_ID,
            history=[]
        )

        self.assertEqual(mock_create.call_count, 1)
        self.assertIn("database", answer.lower())

    @patch("agent.requests.get")
    @patch("agent.client.messages.create")
    def test_agent_passes_history_to_claude(self, mock_create, mock_get):
        """Prior conversation history must be included in the
        messages sent to Claude so it maintains context."""
        mock_create.return_value = self._make_response("end_turn", [
            self._make_text_block("Here are the results.")
        ])

        prior_history = [
            {"role": "user",      "content": "What tables exist?"},
            {"role": "assistant", "content": "There is an invoices table."}
        ]

        run_agent("Show me the top 5 invoices", self.CONNECTION_ID, prior_history)

        call_messages = mock_create.call_args[1]["messages"]

        # history messages should appear before the new user message
        self.assertEqual(call_messages[0]["role"], "user")
        self.assertEqual(call_messages[0]["content"], "What tables exist?")
        self.assertEqual(call_messages[1]["role"], "assistant")


# -------------------------------------------------------
# Layer 3: End-to-end smoke test against real services
# Only runs when RUN_E2E=1 is set — requires a live Flask
# server and valid ANTHROPIC_API_KEY
# -------------------------------------------------------
import os

@unittest.skipUnless(os.environ.get("RUN_E2E") == "1", "Set RUN_E2E=1 to run")
class TestEndToEnd(unittest.TestCase):
    """
    Sends a real message to the agent against a live Flask
    server with the Chinook database connected.

    Run with:
      RUN_E2E=1 CONNECTION_ID=<your-id> python -m pytest test_agent.py -v
    """

    CONNECTION_ID = os.environ.get("CONNECTION_ID", "")

    def test_schema_question(self):
        answer, history = run_agent(
            user_message="What tables are in this database?",
            connection_id=self.CONNECTION_ID,
            history=[]
        )
        self.assertIsInstance(answer, str)
        self.assertGreater(len(answer), 0)
        print(f"\nAgent answer:\n{answer}")

    def test_revenue_question(self):
        answer, history = run_agent(
            user_message="What is the total revenue across all invoices?",
            connection_id=self.CONNECTION_ID,
            history=[]
        )
        self.assertIsInstance(answer, str)
        # Chinook invoices table has known data — answer should mention a number
        self.assertTrue(any(char.isdigit() for char in answer))
        print(f"\nAgent answer:\n{answer}")

    def test_multi_turn_conversation(self):
        """Verify the agent maintains context across turns."""
        answer1, history = run_agent(
            "Which country has the most customers?",
            self.CONNECTION_ID,
            []
        )
        answer2, history = run_agent(
            "How much revenue did that country generate?",
            self.CONNECTION_ID,
            history   # pass history from turn 1
        )
        self.assertIsInstance(answer2, str)
        print(f"\nTurn 1: {answer1}")
        print(f"Turn 2: {answer2}")


if __name__ == "__main__":
    unittest.main(verbosity=2)