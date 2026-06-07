# Notion AI Bridge

> A local HTTP server that exposes Notion AI as an OpenAI-compatible API for any AI agent (Kilo Agent, Claude Code, Codex, etc.).

```
AI agent (Kilo, Claude Code, …)
        │
        │  HTTP localhost:8787/v1   (OpenAI protocol)
        ▼
┌─────────────────────────┐
│  This bridge (Node.js)  │
│  - Puppeteer + Edge 148 │
│  - Talks to Notion as   │
│    real browser          │
└──────────┬──────────────┘
           │
           ▼
      Notion AI (Opus 4.8 / GPT 5.5)
```

## What this does

Runs a small HTTP server on `http://127.0.0.1:8787/v1` that accepts standard OpenAI `chat.completions` requests and proxies them to Notion AI. The bridge uses a real Microsoft Edge browser (via Puppeteer) to call Notion's internal API with your real session cookies — this bypasses Notion's bot-detection trust rule, which blocks plain `fetch()` from Node.js.

The model name in the OpenAI request is used to **frame the system prompt**, not to pick a different model — both `notion/opus-4.8` and `notion/gpt-5.5` reach the same underlying Notion model (`ambrosia-tart-high`).

- **`notion/opus-4.8`** → frame as architect. Good for spec reviews, design feedback, "is this a good idea?"
- **`notion/gpt-5.5`** → frame as developer. Good for "write the code based on this review"
- **`notion/sonnet-4`**, **`notion/haiku-4`** → also work

## Prerequisites

You need all of these on the machine that will run the bridge:

- **Node.js 18 or newer** — `node --version` should print `v18.x` or higher
- **Microsoft Edge** — already installed on Windows 10/11; install separately on macOS / Linux
- **Notion desktop app** — installed and **logged in** to a Notion account with **AI access**
- **A Notion AI entitlement** — your Notion workspace must have AI access (Notion Plus, Business, Enterprise with AI add-on, or a Business trial)

## One-time setup

```bash
# 1. Open a terminal in this folder
cd /d C:\Users\YourName\path\to\flowai

# 2. Install dependencies (one time, takes ~1 minute)
npm install

# 3. Create your config from the example template
copy config.example.json config.json
```

Then **edit `config.json`** with a plain-text editor (Notepad on Windows) and fill in three values:

```json
{
  "notion": {
    "userId": "PUT-YOUR-NOTION-USER-ID-HERE",
    "workspaceId": "PUT-YOUR-WORKSPACE-ID-HERE",
    "clientVersion": "23.13.20260605.1144"
  },
  "browser": {
    "cookies": "PUT-YOUR-VERY-LONG-COOKIE-STRING-HERE"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787,
    "apiKey": "PUT-ANY-RANDOM-PASSWORD-HERE"
  }
}
```

### How to get each value

#### `notion.userId` and `notion.workspaceId`

1. Open Microsoft Edge, go to `https://app.notion.com`, make sure you're logged in.
2. Press **F12** to open DevTools.
3. Click the **Application** tab → **Cookies** → `https://app.notion.com`.
4. Find the row named `notion_user_id`. Copy its **Value** — that's your `userId` (a UUID like `376d872b-594c-8175-8c79-000207773147`).
5. Open one of your Notion pages. Look at the URL — it contains your workspace ID. The URL looks like `https://www.notion.so/your-workspace/AAAA-BBBB-CCCC...`. The `AAAA-BBBB-CCCC...` part is your `workspaceId`.

#### `browser.cookies` (one-time, expires every few weeks)

1. In the same DevTools window, click the **Network** tab.
2. Press **F5** to refresh the page.
3. Click any network request in the list (one named `getSpaces` or any request to `app.notion.com`).
4. On the right side, find **Request Headers**, then the long line starting with `cookie:`.
5. Right-click it → **Copy value**. That's your `browser.cookies` — a very long string like `notion_browser_id=8f67...; device_id=944c...; token_v2=v03%3AeyJ...; ...`

> 🔒 **Keep `config.json` private!** It contains your Notion login. Don't share it, don't commit it to git (the `.gitignore` already excludes it), don't post it online.

#### `server.apiKey` (make up anything)

This is just a password you invent. It can be anything (`banana-rocket-99`, `sk-friend-1234`, etc.). You reuse this exact string in your AI agent config later, so the two can recognize each other.

## Running the bridge

Open a terminal in this folder and run:

```bash
node src/server.js
```

You should see something like:

```
[2026-06-06T20:30:00.000Z] [info] Notion-AI-Bridge listening on http://127.0.0.1:8787
[2026-06-06T20:30:00.001Z] [info]   mode:    LIVE
[2026-06-06T20:30:00.001Z] [info]   auth:    ENABLED (key configured)
[2026-06-06T20:30:00.002Z] [info]   endpoint: https://app.notion.com/api/v3/runInferenceTranscript
```

**Keep this terminal open.** As long as it's open, the bridge is running. To stop, press `Ctrl+C`.

Optionally, set the port via env var before starting (default is `8787`):

```bash
# Windows PowerShell
$env:PORT = "9000"; node src/server.js
```

## Verifying it works

Open a **second** terminal (keep the first running the bridge). Run a test with `curl`:

**Windows (PowerShell):**
```powershell
curl http://127.0.0.1:8787/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer banana-rocket-99" `
  -d '{\"model\":\"notion/opus-4.8\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 2+2? Just the number.\"}]}'
```

(Replace `banana-rocket-99` with whatever you put for `server.apiKey` in `config.json`.)

**Expected output:** a JSON block with `"content": "4"` (or similar short answer from Notion).

If you see a `4`, the bridge is working. If you see an error, see [Troubleshooting](#troubleshooting) below.

## Using from an AI agent (Kilo Agent example)

In **Kilo Agent → Settings → Providers → Add Custom OpenAI Provider**:

| Setting | Value |
| --- | --- |
| **Provider type** | OpenAI Compatible |
| **Base URL** | `http://127.0.0.1:8787/v1` |
| **API Key** | the same `server.apiKey` you set in `config.json` |
| **Model name** | `notion/opus-4.8` (or `notion/gpt-5.5`, `notion/sonnet-4`, `notion/haiku-4`) |

Other agents that support custom OpenAI endpoints (Cursor, Cline, Continue, Aider, OpenHands, Claude Code via `ANTHROPIC_BASE_URL`, Codex via `OPENAI_BASE_URL`, etc.) all use the same fields.

## Recommended workflow: Opus reviews, GPT 5.5 codes

This is the pattern that makes the bridge useful. Your main agent (e.g. Kilo's MiniMax-M3 brain) stays in charge, and calls the bridge twice for non-trivial work:

### Step 1 — Architecture review with Opus 4.8
```
POST http://127.0.0.1:8787/v1/chat/completions
{
  "model": "notion/opus-4.8",
  "messages": [
    { "role": "system", "content": "You are a senior architect. Review this spec for risks. Do NOT write code. Max 6 bullets." },
    { "role": "user", "content": "<your spec or design here>" }
  ]
}
```
Opus replies with a focused critique (cache key collisions, missing cost cap, etc.). This is short and high-signal.

### Step 2 — Code generation with GPT 5.5
```
POST http://127.0.0.1:8787/v1/chat/completions
{
  "model": "notion/gpt-5.5",
  "messages": [
    { "role": "system", "content": "You are a senior dev. Write production Python with type hints." },
    { "role": "user", "content": "<your spec>\n\nARCHITECT REVIEW:\n<Opus's review from step 1>" }
  ]
}
```
GPT 5.5 returns finished code that addresses the specific concerns Opus raised. The model name framing is what nudges the system into the right role — both calls hit the same backend, but the system prompts shape the output differently.

## File layout

```
flowai/
├── src/                       The working bridge
│   ├── server.js              Express HTTP server, OpenAI-compatible endpoints
│   ├── notion-client.js       Builds Notion API requests, parses the JSON-Patch response
│   ├── openai-to-notion.js    Converts OpenAI request format → Notion transcript format
│   ├── puppeteer-client.js    Launches real Edge browser, calls Notion from the page
│   ├── load-config.js         Reads config.json
│   └── logger.js
├── node_modules/              Generated by `npm install` (not in git)
├── config.example.json        Template — copy to config.json and fill in
├── package.json               npm project file (declares deps + scripts)
├── package-lock.json          Pinned dependency versions (do not delete)
├── README.md                  This file
├── LICENSE                    MIT + disclaimer
└── .gitignore                 Excludes config.json, node_modules, runtime files
```

`config.json` and `cookies.json` are **excluded by `.gitignore`** — they contain your real Notion login. Never commit them.

## Troubleshooting

### `node: not recognized` or `npm: not recognized`
Node.js isn't installed or not on PATH. Install from [nodejs.org](https://nodejs.org), then **fully close and reopen** the terminal.

### Bridge starts but every request returns `Cannot read properties of null (reading 'evaluate')`
Your Notion cookies are missing or invalid. Open `config.json` and re-paste the full cookie string from Section "How to get each value" above.

### Bridge returns `401 Unauthorized` from Notion
Your `token_v2` cookie has expired. Re-do the cookie extraction step in your browser DevTools and update `config.json`.

### Bridge returns `AI inference is not allowed` (HTTP 403 with `subType: "trust-rule-denied"`)
Your Notion workspace doesn't have AI access. Open Notion desktop, click the AI button, and confirm AI features work. If your plan doesn't include AI, the bridge can't help — you'd need to add AI to your Notion plan.

### Kilo Agent says "connection refused" or "invalid API key"
- Make sure the bridge terminal is still open and shows "listening" (not crashed)
- Make sure `server.apiKey` in `config.json` matches the API key in Kilo exactly (no extra spaces, no line breaks)

### Edge opens a window briefly and closes
Cookies are stale. Re-do the cookie extraction. The whole value is needed — it should be **very long** (hundreds of characters), starting with `notion_browser_id=...`.

### Port `8787` is already in use
Set a different port before starting:
```bash
# Windows PowerShell
$env:PORT = "9000"; node src/server.js
```
And update Kilo's Base URL to `http://127.0.0.1:9000/v1`.

### Bridge starts, request returns `400 ValidationError`
The body shape is being rejected by Notion. This usually means `clientVersion` is outdated. Update `notion.clientVersion` in `config.json` to match your current Notion desktop build (find it in `app.asar` or via `Notion → About Notion`).

## How to update

To refresh dependencies after editing `package.json`:
```bash
npm install
```

To upgrade to newer dependency versions:
```bash
npm update
```

Your `config.json` is never touched by these — your settings persist.

## Limitations

- **Unofficial.** Not made or supported by Notion. May violate Notion's [Terms of Service](https://www.notion.so/Terms-of-Service). Your account could theoretically be limited or suspended.
- **Cookies expire.** Every few weeks, the `token_v2` cookie in your browser will expire. Re-do the cookie extraction and update `config.json`.
- **Stale client version.** Notion rotates the `clientVersion` periodically. If the bridge suddenly stops working, update `notion.clientVersion` in `config.json`.
- **Single workspace.** The bridge uses one set of cookies, so it talks to one Notion workspace. To use a different workspace, re-extract cookies while logged in there.
- **Not a coding agent.** The bridge is just a "translator" between your AI agent and Notion. It doesn't read your local files, run commands, or edit your code — that's your agent's job (Kilo, Claude Code, etc.). Use it to **call** Notion AI for review or code generation; apply results yourself or let your agent apply them.

## License

MIT. See `LICENSE`.
