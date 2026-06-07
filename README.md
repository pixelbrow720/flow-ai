# Notion AI Bridge

> A local HTTP server that exposes **Notion AI as an OpenAI-compatible API**
> for any AI agent (Kilo, Claude Code, Codex, Cursor, Aider, …). Calls
> the real Notion AI — Opus, GPT, Gemini, Grok, DeepSeek, Kimi — through
> a logged-in Edge browser session, so trust-rule bot detection is bypassed.

```
AI agent (Kilo, Claude Code, Cursor, …)
        │
        │  HTTP localhost:8787/v1   (OpenAI protocol)
        ▼
┌─────────────────────────┐
│  Notion-AI-Bridge       │   19 real models (Opus 4.8, GPT-5.5, …)
│  Puppeteer + Edge       │
│  Talks to Notion as     │
│  a real browser         │
└──────────┬──────────────┘
           │
           ▼
      Notion AI (your logged-in account)
```

## TL;DR (4 commands)

```powershell
git clone https://github.com/pixelbrow720/flow-ai.git
cd flow-ai
.\flow-setup.bat          # opens Edge, you log in, config auto-captured
.\flow.bat                # starts the bridge on :8787
```

When `flow-setup.bat` finishes it prints an **API key** like
`sk-bridge-1a2b3c4d5e6f7890abcdef1234567890`. **Copy it** — you'll paste
it into your AI agent's config. (You can always read it back later from
`config.json` → `server.apiKey`.)

Then in your AI agent:

```
Base URL:  http://127.0.0.1:8787/v1
API Key:   sk-bridge-1a2b3c4d5e6f7890abcdef1234567890   (yours, from flow-setup)
Model:     notion/opus-4.8     (or any of 19 — see table below)
```

That's it. No manual cookie copy-pasting, no DevTools, no JSON editing.

## Prerequisites

- **Node.js 18+** — https://nodejs.org (LTS). `node --version` should print ≥ 18.
- **Microsoft Edge** — already on Windows 10/11; install separately on macOS/Linux.
- **A Notion account with AI access** — Notion Plus, Business, Enterprise with AI add-on, or trial.
- **Windows** for the `.bat` flow scripts. (Mac/Linux users: the Node code
  is portable; just run `node flow-setup.js` and `node src/server.js` directly.)

## What this does

`flow-setup.bat` opens a real Microsoft Edge window pointed at
`app.notion.com`. You log in to **your** Notion account. The script watches
your session, captures the cookies + user ID + workspace ID, generates an
API key, and writes `config.json` to your local machine.

`flow.bat` then starts a small Node.js HTTP server on
`http://127.0.0.1:8787/v1` that accepts standard OpenAI `chat.completions`
requests and proxies them to Notion AI through the same Edge session.
Because the call comes from a real Chromium with the right cookies, it
bypasses Notion's bot-detection trust rule that blocks plain `fetch()` from
Node.js.

The bridge supports **19 distinct real Notion models** (Anthropic, OpenAI,
Gemini, xAI, plus third-party). All are routed by the same `model` field
in the OpenAI request — no client-side config needed.

### Available models

Discovered via `GET https://app.notion.com/api/v3/getAvailableModels` on
2026-06-07. The bridge auto-maps friendly aliases to the internal id Notion
expects:

| Alias (you call)         | Internal id                   | Notion label        | Family     |
|--------------------------|-------------------------------|---------------------|------------|
| `notion/opus-4.8`        | `ambrosia-tart-high`          | Opus 4.8            | anthropic  |
| `notion/opus-4.7`        | `apricot-sorbet-high`         | Opus 4.7            | anthropic  |
| `notion/opus-4.6`        | `avocado-froyo-medium`        | Opus 4.6            | anthropic  |
| `notion/sonnet-4.6`      | `almond-croissant-low`        | Sonnet 4.6          | anthropic  |
| `notion/haiku-4.5`       | `anthropic-haiku-4.5`         | Haiku 4.5           | anthropic  |
| `notion/gpt-5.5`         | `opal-quince-medium`          | GPT-5.5             | openai     |
| `notion/gpt-5.4`         | `oval-kumquat-medium`         | GPT-5.4             | openai     |
| `notion/gpt-5.4-mini`    | `oregon-grape-medium`         | GPT-5.4 Mini        | openai     |
| `notion/gpt-5.4-nano`    | `otaheite-apple-medium`       | GPT-5.4 Nano        | openai     |
| `notion/gpt-5.2`         | `oatmeal-cookie`              | GPT-5.2             | openai     |
| `notion/gemini-3.1-pro`  | `galette-medium-thinking`     | Gemini 3.1 Pro      | gemini     |
| `notion/grok-4.3`        | `xigua-mochi-medium`          | Grok 4.3            | xai        |
| `notion/grok-0.1`        | `xinomavro-cake`              | Grok Build 0.1      | xai        |
| `notion/deepseek-v4-pro` | `baseten-deepseek-v4-pro`     | DeepSeek V4 Pro     | 3rd party  |
| `notion/kimi-k2.6`       | `fireworks-kimi-k2.6`         | Kimi K2.6           | 3rd party  |
| `notion/minimax-m2.5`    | `fireworks-minimax-m2.5`      | MiniMax M2.5        | 3rd party  |

You can also call by **internal id directly** (passthrough) — e.g.
`notion/ambrosia-tart-high` works the same as `notion/opus-4.8`.

**Rule of thumb:**
- Architecture review, deep reasoning → `notion/opus-4.8`
- Code generation, refactors → `notion/gpt-5.5`
- Cheap classification / quick extraction → `notion/haiku-4.5` or `notion/gpt-5.4-nano`
- Second opinion from a different family → `notion/grok-4.3` or `notion/gemini-3.1-pro`

Refresh the list any time: `curl http://127.0.0.1:8787/v1/admin/notion-models -H "Authorization: Bearer <your-key>"`

## One-time setup (Windows)

1. **Clone this repo** in PowerShell or Command Prompt:
   ```powershell
   git clone https://github.com/pixelbrow720/flow-ai.git
   cd flow-ai
   ```
   The folder will be called `flow-ai` (matches the GitHub repo name).
   You can rename it to whatever you like — the scripts use `%~dp0`
   so they find themselves relative to their own location.

2. **Double-click `flow-setup.bat`** (or run it from the terminal). It will:
   - Check Node.js and Edge are installed.
   - Run `npm install` if `node_modules/` is missing (one-time, ~1 min).
   - Launch a real Edge window at `app.notion.com`.
   - Wait for you to **log in to your Notion account** in that window.
     (You have 5 minutes to complete the login.)
   - Capture your cookies, user ID, and workspace ID from the browser session.
   - Generate an API key, write `config.json` to your local disk.
   - Print the API key to the console — **copy it**, you'll need it in your agent.
     (If you forget, it's also in `config.json` under `server.apiKey`.)

3. **Double-click `flow.bat`** to start the bridge.

### What to do with the API key

The API key is a random secret the bridge requires so only your AI
agent can call it. Three things to know:

- **Use it in your AI agent** (Kilo / Claude Code / Cursor / 9router / …) as
  the OpenAI provider's API key.
- **Don't share it** with anyone else on your machine.
- **To find it again later**: read `config.json` → `server.apiKey` in any
  text editor. It's a string like `sk-bridge-xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

**macOS / Linux:** run `node flow-setup.js` and `node src/server.js` directly
from a terminal in the repo folder. The `userDataDir` for the puppeteer
launch is hardcoded to `C:\Users\...` — edit `flow-setup.js` line ~50 to
match your platform if you're not on Windows.

## Daily use (Windows)

| Script             | What it does                                                         |
|--------------------|----------------------------------------------------------------------|
| `flow-setup.bat`   | **One-time** per machine. Captures your Notion session into `config.json`. |
| `flow.bat`         | **Start the bridge.** Auto-starts 9router if installed, then starts the bridge on :8787. Idempotent (safe to double-click). |
| `flow-stop.bat`    | **Stop the bridge.** Reads `bridge.pid` and kills that process only. Won't touch 9router. |
| `flow-logs.bat`    | **Tail `server.log`.** Useful when debugging.                        |

**To stop everything:** close the `9router` window + double-click `flow-stop.bat`.

## Verify it works (60 seconds)

After `flow.bat` shows "Ready", open a **second** terminal in the same
folder and run these to confirm the bridge is healthy and reachable:

```powershell
# 1. Bridge health (should print JSON with status:ok)
curl http://127.0.0.1:8787/health

# 2. List of 19 models the bridge exposes
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer YOUR_API_KEY"

# 3. Real chat — 2+2 should come back as 4 in ~6s
$KEY = (Get-Content config.json | ConvertFrom-Json).server.apiKey
$body = '{"model":"notion/opus-4.8","messages":[{"role":"user","content":"What is 2+2? Just the number."}]}'
curl http://127.0.0.1:8787/v1/chat/completions -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d $body
```

If all three return successfully, you're done. Point your AI agent at
`http://127.0.0.1:8787/v1` with the API key and start calling models.

## Using from an AI agent

### Kilo / Claude Code / Cursor / Aider / etc. (any OpenAI-compatible agent)

```
Base URL:  http://127.0.0.1:8787/v1
API Key:   <printed by flow-setup.bat>
Model:     notion/opus-4.8     (or any of the 19)
```

### 9router (recommended for multi-provider setups)

If you use **9router** (or any OpenAI-compatible router) to combine this
bridge with other LLM providers:

1. In 9router UI, **Add OpenAI Compatible** with:
   - **Name**: `aurora`
   - **Prefix**: `aurora`
   - **API type**: `chat completions`
   - **Base URL**: `http://127.0.0.1:8787/v1`
   - **API Key**: the key from `flow-setup.bat`
   - **Model IDs**: `opus-4.8, opus-4.7, gpt-5.5, gpt-5.4, sonnet-4.6, haiku-4.5` (start here, add more later)
2. In your AI agent, point at 9router instead:
   - **Base URL**: `http://127.0.0.1:20128/v1` (9router's port)
   - **API Key**: 9router's own API key
   - **Model**: `aurora/opus-4.8` (prefix routes through to the bridge)
3. `flow.bat` will auto-start 9router if it's not already up.

## File layout

```
.
├── src/                       The bridge (Node.js + Express)
│   ├── server.js              Express HTTP server, OpenAI-compatible endpoints
│   ├── notion-client.js       Builds Notion API requests, parses the JSON-Patch response
│   ├── openai-to-notion.js    Converts OpenAI request format → Notion transcript format
│   ├── puppeteer-client.js    Launches real Edge browser, calls Notion from the page
│   ├── load-config.js         Reads config.json (handles both flat and nested layouts)
│   └── logger.js
├── docs/
│   ├── ARCHITECTURE.md
│   ├── AGENT_SYSTEM_PROMPT.md System prompt template for AI agents using this bridge
│   ├── CAPTURE.md
│   └── RESEARCH.md
├── flow-setup.bat             First-time setup: open Edge, capture cookies, write config.json
├── flow-setup.js              Node script backing flow-setup.bat
├── flow.bat                   Start bridge (+ auto-start 9router if installed)
├── flow-stop.bat              Stop bridge by PID
├── flow-logs.bat              Tail server.log
├── config.example.json        Template — DO NOT edit; copy structure for config.json
├── config.json                YOUR credentials (gitignored, created by flow-setup.bat)
├── package.json               npm project (start script, deps)
├── package-lock.json          Pinned dep versions
├── .gitignore                 Excludes config.json, node_modules, runtime files
├── LICENSE                    MIT
└── README.md                  This file
```

`config.json`, `bridge.pid`, `server.log`, `server.err` are all
**excluded by `.gitignore`** — they contain your real Notion login.
Never commit them. `flow-setup.bat` writes `config.json` to your
local disk and never sends it anywhere.

## How it works (short version)

1. `flow-setup.bat` launches Puppeteer with a fresh Edge user-data-dir.
2. It navigates to `app.notion.com`, waits for you to log in.
3. After login, it reads all cookies, finds the `notion_user_id` cookie
   (that's `userId`), and watches the next `app.notion.com/api/...` request
   to grab `x-notion-space-id` from the headers (that's `workspaceId`).
4. `config.json` is written.
5. `flow.bat` launches the bridge, which loads `config.json`, launches
   Puppeteer again (in headless mode) with the same cookies, and serves
   `http://127.0.0.1:8787/v1` as a standard OpenAI endpoint.
6. When your agent sends a `chat.completions` request, the bridge builds
   a Notion "transcript" body, sends it via the in-page `fetch()`, and
   extracts the long-form text from the `application/x-ndjson` response.

The puppeteer trick is the key: Notion's trust rule rejects requests that
don't come from a real browser session with valid cookies + correct
TLS/HTTP-2 fingerprint. By running the call from inside the actual
Edge instance we launched, we satisfy that check.

## Troubleshooting

### `node: not recognized` or `npm: not recognized`
Node.js isn't on PATH. Install from [nodejs.org](https://nodejs.org), then
**fully close and reopen** the terminal.

### `Edge not found`
Install Microsoft Edge from [microsoft.com/edge](https://www.microsoft.com/edge).

### Setup script times out (5 min) waiting for login
You're being prompted for 2FA, SSO, or your password manager isn't filling
in. Complete the login in the Edge window within 5 minutes.

### `workspaceId could not be detected`
Stay on the Notion home page after login (don't close Edge). The script
needs to see at least one `app.notion.com/api/...` request, which fires
when Notion's UI loads your workspace.

### Bridge returns `400 ValidationError` or `Expected value to never occur: "X"`
`notion.clientVersion` in `config.json` is stale. Notion rotates this
periodically. Either re-run `flow-setup.bat` (it'll capture the current
version) or manually update it to match your current Notion desktop build
(found in `app.asar` or `Notion → About Notion`).

### Bridge returns `trust-rule-denied` (`AI inference is not allowed`)
Your workspace doesn't have AI access. Verify by opening Notion desktop,
clicking the AI button — if AI doesn't work there, it won't work via
this bridge either. You need a Notion plan with AI (Plus / Business /
Enterprise + AI add-on / trial).

### Bridge returns empty `content: ""` on every request
Cookies expired. Re-run `flow-setup.bat`. Notion's `token_v2` lasts a few
weeks before it rotates; re-extract then.

### Port `8787` is already in use
Something else is on the port. Either stop that other thing, or set a
different port by setting `server.port` in `config.json` to (say) `8788`
and `PORT=8788` before running `flow.bat`. Update your agent's Base URL
to match.

### `flow.bat` says "9router did not bind port 20128 in 15s"
9router isn't installed or `9router` isn't on PATH / not in `C:\Users\ollama\`.
The bridge will still start, but Kilo routing via 9router won't work
until 9router is up. The bridge alone is still useful for direct calls.

## Limitations

- **Unofficial.** Not made or supported by Notion. May violate Notion's
  [Terms of Service](https://www.notion.so/Terms-of-Service). Your
  account could theoretically be limited or suspended.
- **Cookies expire.** Every few weeks, re-run `flow-setup.bat`.
- **Single workspace.** The bridge uses one set of cookies, so it
  talks to one Notion workspace at a time. Re-run `flow-setup.bat` while
  logged in to a different workspace to switch.
- **Not a coding agent.** The bridge is just a translator between your
  AI agent and Notion. It doesn't read your local files, run commands,
  or edit your code — that's your agent's job.
- **Single Notion account.** Re-running `flow-setup.bat` overwrites
  `config.json`. Don't run it twice in a row.

## License

MIT. See `LICENSE`.
