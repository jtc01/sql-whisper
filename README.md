# SQL Whisper

**Talk to any database in plain English. Voice or text.**

SQL Whisper is a voice-and-text AI database assistant built for SCU Hack-A-Stack 2026. Connect any MySQL or TDSQL-compatible database, ask questions in natural language, and get back real SQL, real results, and semantic insights — no SQL knowledge required.

Built in 24 hours by three Santa Clara University students.

---

## What it does

Type or speak a question. Get back an answer.

> **You:** "Show me the top 5 customers by total spending"
>
> **Whisper:** Here are your top 5 customers...
> | Rank | Customer Name | Total Spending |
> |------|---------------|----------------|
> | 1 | KARL SEAL | $221.55 |
> | 2 | ELEANOR HUNT | $216.54 |
> ...
>
> KARL SEAL is your top customer with a total spending of $221.55. Interestingly, MARION SNYDER and RHONDA KENNEDY are tied at $194.61.

The agent introspects the database schema, generates safe SQL, runs it, and explains the result — including semantic insights like top values, computed averages, and qualitative tags.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (React)                  │
│           Atomic Command Surface architecture          │
│   Connections │ Query Input │ Voice │ History │ Results │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────┐
│                   Backend (Flask + Python)             │
│                                                        │
│  /ask  ──▶ Claude agent (tool-use loop)                 │
│              ├─▶ get_schema  ──▶ INFORMATION_SCHEMA     │
│              └─▶ run_query   ──▶ Safety pipeline:       │
│                                   • Comment strip      │
│                                   • SELECT-only        │
│                                   • Single-statement   │
│                                   • Row cap (500)      │
│                                   • Dual-layer timeout  │
│                                                        │
│  /trtc/*  ──▶ Tencent TRTC + StartAITranscription       │
│  /connections, /history, /schema, /tables, /query      │
└──────────────────────────┬──────────────────────────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
   App DB (MySQL/TDSQL)              User DB (MySQL/TDSQL)
   • Encrypted credentials           • The data being queried
   • Query history                   • Schema introspected
   • Auto-saved results              • Read-only access
```

---

## Tech stack

**Backend**
- Flask + flask-cors
- pymysql + cryptography (Fernet)
- Anthropic Claude (`claude-haiku-4-5`) via the official SDK
- Tencent Cloud TRTC + StartAITranscription
- MySQL 8 / TDSQL-compatible

**Frontend**
- React with Atomic Command Surface architecture
- TRTC SDK v5 for voice input
- Tailwind CSS for styling

**Infrastructure**
- Docker for local databases
- ngrok for live frontend-backend tunnel during development

---

## Features

### Natural language → SQL
A Claude-powered agent calls tool definitions (`get_schema`, `run_query`) in a loop until it has enough information to answer. Generates correctly-joined multi-table SQL on the first try for most questions.

### Semantic stat cards
A second Claude call produces three editorialized stat cards per query — not just row counts, but computed insights like top values, group averages, and qualitative tags (e.g. "Premium Tier", "High Threat Level"). Each card carries a sentiment color for the UI.

### SQL safety pipeline
Every query passes through:
1. Comment stripping (so `/*SELECT*/ DROP` can't fool the validator)
2. First-token SELECT allowlist
3. Single-statement enforcement (no `SELECT 1; DROP TABLE film`)
4. Automatic row cap injection (`LIMIT 501` — 500 + 1 to detect truncation)
5. Dual-layer 5-second timeouts (client-side thread + MySQL `MAX_EXECUTION_TIME`)

### Credentials encryption
Database credentials are encrypted at rest with Fernet symmetric encryption. Plaintext passwords are decrypted just-in-time for each query and never persisted to logs.

### Voice input
Tencent Cloud TRTC integration. The user joins a TRTC room, an ASR bot joins as a phantom user and streams transcripts via `TRTC.EVENT.CUSTOM_MESSAGE`, and the final sentence gets fed into the same `/ask` pipeline that handles typed queries.

### Auto-saved history
Every successful query is saved to `query_history` with the prompt, results, and stat cards. Click any past entry to replay without re-running the SQL.

---

## API reference

### Connection management
- `POST /connections` — register a database
- `GET /connections` — list connections
- `POST /connections/<id>/test` — verify connection works
- `DELETE /connections/<id>` — remove (cascades to history)

### Schema
- `GET /schema` — full compressed schema (for the LLM)
- `GET /tables` — table list with row counts (for sidebars)

### Query
- `POST /ask` — natural language → SQL + results + stats
- `POST /query` — raw SQL (safety-validated)

### History
- `GET /history?connection_id=<id>` — list
- `GET /history/<id>` — single entry
- `DELETE /history/<id>` — remove

### Voice
- `POST /trtc/usersig` — mint a TRTC UserSig
- `POST /trtc/start-transcription` — spawn ASR bot into room
- `POST /trtc/stop-transcription` — tear down ASR bot

All data endpoints require `X-Connection-Id: <uuid>` header.

---

## Running locally

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file:

```
ENCRYPTION_KEY=<run: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
APP_DB_HOST=localhost
APP_DB_PORT=3316
APP_DB_USER=root
APP_DB_PASS=hackathon
APP_DB_NAME=hackastack_app
ANTHROPIC_API_KEY=<your key>
TRTC_SDK_APP_ID=<from console.trtc.io>
TRTC_SDK_SECRET_KEY=<from console.trtc.io>
TENCENT_SECRET_ID=<from CAM console>
TENCENT_SECRET_KEY=<from CAM console>
TRTC_REGION=ap-singapore
```

Spin up databases:

```bash
docker run --name app-db-mysql -e MYSQL_ROOT_PASSWORD=hackathon -e MYSQL_DATABASE=hackastack_app -p 3316:3306 -d mysql:8
docker run --name demo-db-mysql -e MYSQL_ROOT_PASSWORD=demopass -e MYSQL_DATABASE=sakila -p 3326:3306 -d mysql:8
```

Load the Sakila demo data:

```bash
curl -O https://downloads.mysql.com/docs/sakila-db.tar.gz
tar -xzf sakila-db.tar.gz
docker exec -i demo-db-mysql mysql -uroot -pdemopass sakila < sakila-db/sakila-schema.sql
docker exec -i demo-db-mysql mysql -uroot -pdemopass sakila < sakila-db/sakila-data.sql
```

Initialize the app DB schema (run once):

```bash
docker exec -i app-db-mysql mysql -uroot -phackathon hackastack_app <<EOF
CREATE TABLE user_connections (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT DEFAULT 3306,
  db_name VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  password_enc TEXT NOT NULL,
  db_type VARCHAR(50) DEFAULT 'mysql',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE query_history (
  id CHAR(36) PRIMARY KEY,
  connection_id CHAR(36) NOT NULL,
  name VARCHAR(255),
  prompt TEXT NOT NULL,
  response_payload JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_connection_created (connection_id, created_at DESC)
);
EOF
```

Run Flask:

```bash
python3 app.py
# Backend now live at http://localhost:5001
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Built for SCU Hack-A-Stack 2026

Tracks targeted:
- **Tencent Cloud** — TRTC voice input + TDSQL-compatible architecture
- **Best Use of AI** — Agentic Claude with multi-tool reasoning

---

## What we learned

- Agentic AI with proper tool definitions is dramatically more capable than single-shot prompting for SQL generation. Letting Claude call `get_schema` and `run_query` separately lets it adapt to unknown databases without prompt engineering for every schema.
- SQL safety is a layered problem. Comment stripping must run **before** validation — otherwise an attacker can hide `DROP TABLE` inside `/* */` and slip past the SELECT allowlist.
- Encrypt-at-rest with just-in-time decryption is the right pattern for credential storage even in a hackathon. Fernet makes this five lines of Python.
- Coordinating three developers writing to the same Flask file requires a clear API contract negotiated up front. We aligned on field names (`text`, `created_at`, `database`) and response shapes before either side wrote glue code.

---

## What's next

- Multi-turn conversational queries ("now show me only the ones from California")
- Native chart rendering from `data` arrays (bar / line / pie auto-selected by data shape)
- TDSQL deployment on Tencent Cloud
- Team workspaces with per-user auth

---

## Team

- **Matthew Moyer** — Backend, Tencent integration, AI agent
- **Zach Malinowski** — Frontend, UX, Atomic Command Surface
- **Joshua Cao** — Agent design, prompt engineering

---

## License

MIT
