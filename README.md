# Ouro Platform

Ouro is a self-improving AI software agency. Specialised agents (PM, Researcher, Designer, Developer, Tester, Documenter) collaborate through a shared feed to build software projects autonomously — including Ouro itself.

## Deploying via Caddy (Tailscale)

To serve Ouro at `https://lucial.noodlefish-carat.ts.net/ouro/`:

### 1. Build the React client

```bash
cd client && bun install && bun run build
# Output: client/dist/
```

### 2. Install the Caddyfile

The repo ships a ready-to-use `Caddyfile` at the repo root.

```bash
# Copy to wherever you cloned the repo, e.g. /opt/ouro-platform
git clone <repo> /opt/ouro-platform

# If the dist path in Caddyfile differs, edit the root directive:
#   root * /opt/ouro-platform/client/dist

sudo cp /opt/ouro-platform/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If you already have a `/etc/caddy/Caddyfile` with other sites, paste just the `lucial.noodlefish-carat.ts.net { … }` block from the repo `Caddyfile` into it.

### 3. TLS on Tailscale

Caddy will try to get a certificate automatically. On a Tailscale-only machine (no public port 80), auto-HTTPS won't work. Choose one of:

**Option A — Tailscale cert (recommended):**
```bash
tailscale cert lucial.noodlefish-carat.ts.net
# Writes lucial.noodlefish-carat.ts.net.crt / .key to current dir
sudo mv lucial.noodlefish-carat.ts.net.* /etc/caddy/
```
Then uncomment the `tls /etc/caddy/...` lines in `Caddyfile`.

**Option B — Caddy internal CA (self-signed, quick):**
Add `tls internal` inside the site block in `Caddyfile`.

### 4. Verify

```bash
curl -s https://lucial.noodlefish-carat.ts.net/ouro/ | grep '<title>'
# Expected: <title>Ouro Platform</title>

curl -s https://lucial.noodlefish-carat.ts.net/ouro/api/projects
# Expected: JSON array of projects
```

### Caddyfile route summary

| Caddy path | Strips to | Destination |
|---|---|---|
| `/ouro/api/*` | `/api/*` | `localhost:3001` (Elysia server) |
| `/ouro/ws` | `/ws` | `localhost:3001` (WebSocket) |
| `/ouro/*` | `/*` | `client/dist/` (static files) |
| `/ouro` | — | 308 redirect → `/ouro/` |

---

## How to run

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.0
- Optional: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` for real Claude output (falls back to deterministic mock if not set)

### Install & seed

```bash
# Install dependencies
cd server && bun install && cd ..
cd client && bun install && cd ..

# Seed the database (creates Ouro Platform + Demo Project with agents)
bun run seed
```

### Start the server

```bash
bun run dev
# Server runs on http://localhost:3001
# WebSocket at ws://localhost:3001/ws
```

### Start the client

```bash
bun run dev:client
# Vite dev server on http://localhost:5173
```

### Start a cycle

Via the UI: click **Start Cycle** in the top bar with a project selected.

Via API:
```bash
# Get project ID first
curl http://localhost:3001/api/projects

# Start a cycle
curl -X POST http://localhost:3001/api/projects/<id>/cycle/start
```

## Key env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `DATABASE_URL` | `./ouro.db` | Path to SQLite database file |
| `ANTHROPIC_API_KEY` | — | Anthropic API key for real Claude output |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Alternative auth token for Claude CLI |

If neither token is set, the system uses a deterministic mock output so the loop runs end-to-end in dev.

## Architecture

Ouro is a monorepo with two workspaces: `server/` (Bun + Elysia + SQLite) and `client/` (React + Vite + Tailwind). The server runs a serial phase loop: Research → Spec → Design → Build → Test → Review. Each phase is handled by a dedicated agent that builds on the previous phase's artifacts. Agents call Claude via the CLI subprocess (or mock fallback). Results are stored as versioned artifacts in SQLite. A WebSocket endpoint broadcasts real-time events to the React dashboard as each agent completes its phase.

## What's built vs stubbed

### Built
- Full database schema with versioned artifacts
- All 6 agent implementations (with real Claude CLI calls)
- Serial phase loop with real-time WS broadcasting
- REST API (projects, feed, inbox, agents, artifacts, cycle)
- WebSocket real-time feed
- Three-panel React dashboard (agents, feed, inbox)
- Project switcher with multiple projects
- Inbox reply flow
- Seed data (Ouro Platform + Demo Project)

### Stubbed (TODO)
- **Developer agent**: produces an implementation plan (`build.md`) instead of running real code. See `server/src/agents/developer.ts` for the TODO comment showing where Claude Code subprocess integration goes.
- **Tester agent**: produces a notional test report instead of running real Playwright. See `server/src/agents/tester.ts`.
- **GitHub Issues**: tester logs "would raise GH issue" to feed. Real `gh issue create` integration is TODO.
- **Email/SMTP**: no notifications beyond inbox
- **Auth**: no authentication — single user
- **Docker isolation**: agents run in the same process

## Next steps

1. Real Claude Code subprocess in developer agent (spawn CC in project working dir, capture diffs, commit to git)
2. Real Playwright E2E tests in tester agent
3. GitHub Issues integration for test failures
4. WS broadcast for inbox events (fix: unread badge doesn't update in real time)
5. Streaming Claude output via SSE so feed populates token-by-token
