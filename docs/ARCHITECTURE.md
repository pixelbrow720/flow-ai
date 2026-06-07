# Architecture

## Overview

```
AI agent (Kilo, Claude Code, Cursor, …)
        │
        │  HTTP localhost:8787/v1   (OpenAI protocol)
        ▼
┌─────────────────────────┐
│  Notion-AI-Bridge       │   Node.js + Express
│  localhost:8787         │   Puppeteer + real Edge 148
│  Stateless, 16 models   │   Trusts the browser's TLS fingerprint
└────────┬────────────────┘
         │  fetch() from inside Edge
         ▼
   Notion AI (app.notion.com/api/v3/runInferenceTranscript)
```

For multi-provider setups, route through **9router** at
`localhost:20128` — the bridge becomes one of 9router's
OpenAI-compatible providers, addressed as `aurora/opus-4.8`, etc.

## The bridge

### Endpoints

| Method | Path                       | Auth | Purpose |
|--------|----------------------------|------|---------|
| GET    | `/health`                  | no   | liveness + config summary |
| GET    | `/v1/models`               | yes  | OpenAI-compatible model list (16) |
| POST   | `/v1/chat/completions`     | yes  | OpenAI-compatible chat (streaming + non-streaming) |
| GET    | `/v1/admin/notion-models`  | yes  | live introspection of what Notion returns from `getAvailableModels` |

All endpoints with `yes` auth require `Authorization: Bearer <server.apiKey>`.

### File structure

```
.
├── src/
│   ├── server.js              Express + auth + routes
│   ├── notion-client.js       Builds Notion request body, sends via Puppeteer,
│   │                          parses application/x-ndjson response
│   ├── openai-to-notion.js    OpenAI chat-completion → Notion transcript
│   │                          conversion. Includes 19-entry DEFAULT_MODEL_MAP
│   │                          and DEFAULT_WORKFLOW_CONFIG.
│   ├── puppeteer-client.js    Launches real Edge, manages browser/page lifecycle,
│   │                          callNotionFromBrowser() does fetch() from page context
│   ├── load-config.js         Reads config.json. Supports nested (notion.* / server.*
│   │                          / browser.*) and flat layouts. Exports 19-entry
│   │                          DEFAULT_MODEL_MAP (Anthropic, OpenAI, Gemini, xAI, etc.)
│   └── logger.js
├── flow-setup.bat / .js       First-time: open Edge, capture cookies, write config.json
├── flow-switch-workspace.bat  List workspaces + plan + AI, switch active workspace
├── flow.bat / flow-stop.bat   Start / stop the bridge
├── flow-logs.bat              Tail server.log
└── config.json                credentials (gitignored, created by flow-setup)
```

### Request flow

1. AI agent sends OpenAI-format `POST /v1/chat/completions` with
   `Authorization: Bearer <apiKey>` and body:
   ```json
   {
     "model": "notion/opus-4.8",
     "messages": [
       {"role": "system", "content": "..."},
       {"role": "user", "content": "..."}
     ],
     "stream": false
   }
   ```

2. `server.js` validates auth, then calls
   `handleChatCompletion(req, res, config, {mock: false})` from
   `openai-to-notion.js`.

3. `resolveModelId("notion/opus-4.8", config)` looks up the alias in
   `config.modelMap` (or the built-in DEFAULT_MODEL_MAP). Result:
   `ambrosia-tart-high` — the internal id Notion's `getThinkingConfig`
   will accept.

4. `buildNotionRequestBody({ openaiReq, modelId, config })` constructs a
   "transcript" body:
   ```json
   {
     "traceId": "<uuid>",
     "spaceId": "<workspaceId>",
     "transcript": [
       {"type": "config",   "value": <workflow config>},
       {"type": "context",  "value": {userId, workspaceId, timezone, ...}},
       {"type": "user",     "value": [["<system msg>"], ["<user msg>"]]}
     ],
     "threadId": "<uuid>",
     "asPatchResponse": true,
     "patchResponseVersion": 2,
     ...
   }
   ```
   `workflowConfig` comes from `config.workflowConfig` (user overrides)
   merged with `DEFAULT_WORKFLOW_CONFIG` (60+ flags). Important overrides
   the user should set in `config.json`:
   ```json
   "workflowConfig": {
     "enableAgentAutomations": false,
     "enableAgentIntegrations": false,
     "enableCustomAgents": false,
     "enableAgentDiffs": false,
     "enableComputer": false,
     "enableQueryMail": false,
     "enableQueryCalendar": false,
     "enableAgentGenerateImage": false,
     "useWebSearch": false
   }
   ```
   All `enable*` to `false` disables agent mode. Defaults are mixed
   (some true, some false); set explicitly to opt out.

5. `sendToNotion({ config, body })` from `notion-client.js`:
   - Builds Notion headers (Sentry baggage + trace with fresh trace-id
     and span-id per request — Notion rejects hardcoded sentry values
     as "fake")
   - Calls `initPuppeteer()` if not already running
   - Calls `callNotionFromBrowser(endpoint, headers, body)` which
     `page.evaluate`s an in-page `fetch()` with `credentials: "include"`.
     Cookies come from the browser session.

6. Response is `application/x-ndjson`. `parseNdjsonResponse`:
   - Iterates lines, parses each as JSON event
   - Looks for the LONG answer in:
     1. `patch-sync.data.s[*]` where `type === "agent-inference"` and
        the value is a non-empty text/content array
     2. `recordMap.thread_message` records with `step.type ===
        "agent-inference"`
     3. Fallback: apply JSON-Patch ops to build state, then read
        `state.s[*]`
   - Filters out parts where `type === "thinking"` (internal
     reasoning, not user-facing text)
   - Returns `{ events, text }`

7. `extractTextFromNotionResponse` returns `text` field; this becomes
   the `content` of the OpenAI-format `choices[0].message`.

### Why Puppeteer (not raw fetch / not MITM)

Notion's `runInferenceTranscript` server has a trust rule
(`checkRunInferenceTranscriptRuleSet`) that:

- Validates TLS fingerprint (must match a real browser)
- Validates HTTP/2 fingerprint (header order, SETTINGS frame)
- Validates Sentry sentry-trace shape (rotated per request)
- Validates `notion-client-version` (must match a current build)

A raw `fetch()` from Node fails on TLS fingerprint. MITM proxying works
but requires root CA + cert generation. Puppeteer with real Edge
satisfies all four checks for free, because the call comes from inside
an actual Chromium instance the user has been logged into.

### State and lifecycle

- `puppeteer-client.js` keeps module-level `browser` and `page`
  references. One Edge instance per process.
- `flow.bat` writes the process PID to `bridge.pid` after launch.
- `flow-stop.bat` reads `bridge.pid` and kills ONLY that process (never
  `Stop-Process -Name node` — would kill 9router, Kilo, etc.)
- `config.json` is read once at startup. Workspace switching requires
  `flow-switch-workspace.bat` which updates the file and restarts the
  bridge.

### Stream parsing — the long-text vs brief-fragment problem

Notion sends two representations of the AI response in the same ndjson
stream:

1. **Patch events** (state.s) — the model's activity log. Contains
   brief fragments like "a page in your workspace or go deeper?"
2. **Patch-sync** (data.s) and **Record-map** (thread_message) — the
   chat thread state. Contains the FULL long response with paragraphs.

The parser tries chat-state sources first (long text) and falls back
to patch state (brief fragment) if not found. This is critical for
returning useful answers — without it, the user only sees the planning
line, not the actual response.

## 9router integration

The bridge is added to 9router as a custom OpenAI-compatible provider
(no MITM handler needed). In 9router UI → "Add OpenAI Compatible":

| Field     | Value                              |
|-----------|------------------------------------|
| Name      | `aurora`                           |
| Prefix    | `aurora`                           |
| API type  | `chat completions`                 |
| Base URL  | `http://127.0.0.1:8787/v1`         |
| API Key   | the key from `flow-setup.bat`      |
| Model IDs | one per line (see below)           |

Recommended model IDs to register (start here, add more later):
```
opus-4.8
opus-4.7
gpt-5.5
gpt-5.4
sonnet-4.6
haiku-4.5
```

In the AI agent, point at 9router instead of the bridge directly:
- Base URL: `http://127.0.0.1:20128/v1`
- API Key: 9router's own key
- Model: `aurora/opus-4.8` (prefix routes through to the bridge)

`flow.bat` will auto-start 9router if it's installed (checks port 20128).

## Model mapping (16 + legacy aliases)

The bridge ships with a 19-entry `DEFAULT_MODEL_MAP` (16 unique Notion
models + 3 legacy aliases for back-compat). All map friendly aliases
to Notion's internal model id. See
`docs/AGENT_SYSTEM_PROMPT.md` §1 for the full table.

| Alias (you call)         | Internal id                   | Family    |
|--------------------------|-------------------------------|-----------|
| `notion/opus-4.8`        | `ambrosia-tart-high`          | anthropic |
| `notion/opus-4.7`        | `apricot-sorbet-high`         | anthropic |
| `notion/opus-4.6`        | `avocado-froyo-medium`        | anthropic |
| `notion/sonnet-4.6`      | `almond-croissant-low`        | anthropic |
| `notion/haiku-4.5`       | `anthropic-haiku-4.5`         | anthropic |
| `notion/gpt-5.5`         | `opal-quince-medium`          | openai    |
| `notion/gpt-5.4`         | `oval-kumquat-medium`         | openai    |
| `notion/gpt-5.4-mini`    | `oregon-grape-medium`         | openai    |
| `notion/gpt-5.4-nano`    | `otaheite-apple-medium`       | openai    |
| `notion/gpt-5.2`         | `oatmeal-cookie`              | openai    |
| `notion/gemini-3.1-pro`  | `galette-medium-thinking`     | gemini    |
| `notion/grok-4.3`        | `xigua-mochi-medium`          | xai       |
| `notion/grok-0.1`        | `xinomavro-cake`              | xai       |
| `notion/deepseek-v4-pro` | `baseten-deepseek-v4-pro`     | 3rd party |
| `notion/kimi-k2.6`       | `fireworks-kimi-k2.6`         | 3rd party |
| `notion/minimax-m2.5`    | `fireworks-minimax-m2.5`      | 3rd party |

Legacy aliases auto-aliased: `notion/opus-4` → Opus 4.7,
`notion/sonnet-4` → Sonnet 4.6, `notion/haiku-3.5` → Haiku 4.5.

You can also call **by internal id directly** (passthrough):
`notion/ambrosia-tart-high` works the same as `notion/opus-4.8`.

To refresh the live list: `curl http://127.0.0.1:8787/v1/admin/notion-models -H "Authorization: Bearer <key>"`

## Security

- `token_v2` is the most sensitive value in `config.json` — it's a
  logged-in session. `.gitignore` excludes the file.
- The bridge binds to `127.0.0.1` only by default (set in
  `server.host`). NOT exposed to LAN.
- API key in `config.json` is a bearer token; anyone with localhost
  access who has the key can call the bridge. Set a strong key.
- `bridge.pid`, `server.log`, `server.err` are also gitignored.

## Known limitations

- **Unofficial.** Not endorsed by Notion. May violate their ToS.
- **Cookies expire** every few weeks. Re-run `flow-setup.bat` to refresh.
- **Single workspace at a time.** `flow-switch-workspace.bat` for
  switching. Multi-workspace routing (e.g. `aurora/work/opus-4.8` vs
  `aurora/personal/opus-4.8`) is a future feature.
- **Not a coding agent.** The bridge translates; the AI agent does
  the actual file edits, shell commands, and tests.
- **Stateless.** Every call is independent. Context must be in
  `messages`. See `AGENT_SYSTEM_PROMPT.md` §1.
