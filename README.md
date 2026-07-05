# pgxray — Postgres Query Analyzer

> See why your Postgres queries are slow — and fix them.

**pgxray** is a web app for understanding and speeding up PostgreSQL queries. Paste SQL, run `EXPLAIN (ANALYZE)` safely, visualize the execution plan as an interactive tree, and get heuristic findings, index suggestions, and AI-powered rewrites — all grounded in your real schema.

🔗 **Live:** [pganalyzer.avikmukherjee.com](https://pganalyzer.avikmukherjee.com)

![pgxray — Postgres Query Analyzer](./public/og-image.png)

---

## Features

- **Execution plan visualization** — Runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and renders the plan as a readable, collapsible node tree with per-node timing, cost, and row estimates.
- **At-a-glance metrics** — A summary strip highlights execution time, planning time, rows returned, and total cost.
- **Heuristic analysis** — Detects common problems (sequential scans, row mis-estimates, expensive sorts, etc.) with plain-English explanations.
- **Index suggestions** — Generates concrete `CREATE INDEX` DDL for the analyzed query.
- **AI rewrites** — Uses an LLM (grounded in your plan + schema) to explain the query, propose an optimized rewrite with rationale, suggest indexes, and teach the relevant Postgres internals.
- **Schema sidebar** — Introspects tables, columns, estimated row counts, and existing indexes; click to insert table names.
- **Bring your own database** — Use the seeded demo database or paste any `postgres://` connection string.
- **MCP server** — Exposes the analyzer as [Model Context Protocol](https://modelcontextprotocol.io) tools so agents (Claude, Cursor, etc.) can analyze queries and inspect schemas directly.
- **Learn mode** — Built-in glossary of plan node types and performance metrics.

## Safety

Query analysis is designed so it can never mutate your data:

- Statements are validated to be a **single command** before running (no `;`-separated batches).
- **Read-only** statements (`SELECT`, `WITH`, `TABLE`, `VALUES`) are executed with `EXPLAIN ANALYZE` inside a `BEGIN; SET TRANSACTION READ ONLY;` block that is always rolled back.
- Any **non-read-only** statement falls back to a plan-only `EXPLAIN` and is never executed.
- Connections fail fast with a 10s connect timeout and a 30s statement timeout.
- Postgres errors are mapped to friendly, actionable messages (SQLSTATE-aware).

## Tech Stack

- **[Next.js 16](https://nextjs.org)** (App Router) + **React 19**
- **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui**
- **[pg](https://node-postgres.com)** for direct PostgreSQL access
- **[AI SDK](https://sdk.vercel.ai)** with **[Groq](https://groq.com)** (`openai/gpt-oss-120b`) for AI analysis
- **[mcp-handler](https://www.npmjs.com/package/mcp-handler)** + `@modelcontextprotocol/sdk` for the MCP server
- **[Neon](https://neon.tech)** Postgres for the demo database

## Getting Started

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io) (recommended)
- A PostgreSQL database for the demo (Neon works great)
- A [Groq API key](https://console.groq.com) for AI features (optional)

### Installation

```bash
git clone https://github.com/Avik-creator/postgres-query-analyzer.git
cd postgres-query-analyzer
pnpm install
```

### Environment variables

Create a `.env.local` file:

```bash
# Seeded demo database (used when no custom connection string is provided)
DATABASE_URL=postgres://user:password@host/db?sslmode=require

# Optional — enables the AI analysis tab
GROQ_API_KEY=gsk_...
```

### Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Write or paste a SQL query in the editor (or pick a sample).
2. Choose the **demo** database or enter a custom `postgres://` connection string.
3. Hit **Analyze** to see the plan, metrics, findings, and index suggestions.
4. Open the **AI** tab for an LLM-powered explanation and rewrite.

## API Routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/analyze` | `POST` | Run EXPLAIN + heuristic analysis for a statement. |
| `/api/schema` | `POST` | Introspect tables, columns, and indexes. |
| `/api/ai` | `POST` | AI explanation, rewrite, and index suggestions. |
| `/[transport]` | `GET`/`POST`/`DELETE` | MCP server endpoint. |

## MCP Server

pgxray is also an MCP server. Point an MCP-compatible client at the deployed endpoint:

```
https://pganalyzer.avikmukherjee.com/mcp
```

Available tools:

- **`analyze_query`** — Returns the execution plan, heuristic findings, and index suggestions for a SQL statement.
- **`get_schema`** — Lists tables, columns, estimated row counts, and existing indexes.

Both tools accept an optional `connectionString`; without it, they use the demo database.

## Project Structure

```
app/
  api/analyze/route.ts     # EXPLAIN + heuristic analysis
  api/schema/route.ts      # schema introspection
  api/ai/route.ts          # AI analysis (Groq via AI SDK)
  [transport]/route.ts     # MCP server
  layout.tsx / page.tsx    # app shell + metadata
components/analyzer/       # editor, plan tree, panels, dialogs
lib/
  db.ts                    # connection handling + error mapping
  sql-safety.ts            # read-only validation + EXPLAIN builder
  runner.ts                # runAnalyze / getSchema
  analyze.ts               # plan parsing + heuristics
```

## Deployment

Deploy on [Vercel](https://vercel.com). Set `DATABASE_URL` and (optionally) `GROQ_API_KEY` in your project's environment variables.

## Built with v0

This repository is linked to a [v0](https://v0.app) project — start a new chat to make changes and v0 pushes commits directly to this repo. Every merge to `main` deploys automatically.

[Continue working on v0 →](https://v0.app/chat/projects/prj_ro0YyLv1P3ktky95buknp9XxDjrZ)

## License

MIT
