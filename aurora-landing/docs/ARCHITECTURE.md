# Architecture

## Overview

```
┌─────────────────┐
│  CLI / Editor   │  (Claude Code, Codex, Cursor, Cline)
│  (OpenAI client)│
└────────┬────────┘
         │ POST /v1/chat/completions
         │ Authorization: Bearer <api_key>
         ↓
┌──────────────────────────────────────────────────────────┐
│  9Router (localhost:20128)                              │
│  • OpenAI-format router                                 │
│  • Routes ke provider "notion" via upstream URL         │
└────────┬─────────────────────────────────────────────────┘
         │ 2 pilihan koneksi:
         │
    ┌────┴────────────────────────────────────┐
    │                                         │
    ↓ A                                        ↓ B
┌────────────────────┐              ┌────────────────────────┐
│ A. Notion Bridge   │              │ B. 9router MITM        │
│    (Node.js)       │              │    (built-in)          │
│  localhost:20130   │              │  intercept HTTPS       │
│  OpenAI-compat     │              │  www.notion.so:443     │
└────────┬───────────┘              └────────┬───────────────┘
         │ POST <notion>/api/v3/...         │ sama
         │ cookie: token_v2=...             │
         ↓                                  ↓
┌──────────────────────────────────────────────────────────┐
│  Notion API  (www.notion.so / app.notion.com)            │
│  • Verifies token_v2                                    │
│  • Routes ke Claude Opus 4 / GPT 5.5 (subscription)     │
│  • Returns AI response                                  │
└──────────────────────────────────────────────────────────┘
```

## Opsi A — Standalone Bridge

**File**: `notion-bridge/server.js`

```js
// Receive OpenAI request from 9router
POST /v1/chat/completions
{
  "model": "notion/opus-4.8",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}

// Convert to Notion format (depends on capture)
// Forward ke Notion dengan token_v2

// Stream response balik convert ke OpenAI SSE format
data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...}
data: [DONE]
```

**File structure**:
- `server.js` — Express/Fastify server, route `/v1/chat/completions` + `/v1/models`
- `lib/openai-to-notion.js` — convert OpenAI request → Notion request body
- `lib/notion-client.js` — HTTP client, streaming, retry, error handling
- `lib/notion-stream-parser.js` — parse Notion SSE/JSON → OpenAI SSE chunks
- `lib/token-store.js` — load token dari config, refresh kalau ada 401
- `lib/logger.js` — debug logging
- `config.json` — `{ token, userId, workspaceId, clientVersion, apiVersion, endpoint }`

## Opsi B — 9router MITM Handler

**File**: `mitm-handler/notion.js`

Reuse infrastruktur MITM 9router (root CA, DNS override, cert generation).
Tambah:

1. `mitm/config.js` → `TARGET_HOSTS` += `["www.notion.so", "app.notion.com"]`
2. `mitm/config.js` → `URL_PATTERNS.notion = ["/api/v3/..."]`
3. `mitm/config.js` → `getToolForHost()` += case notion
4. `mitm/handlers/notion.js` → logic convert + forward
5. `mitm/server.js` → register handler
6. `shared/constants/providers.js` → tambah provider "notion" + model aliases
7. `lib/localDb.js` atau store → simpan token_v2 Notion

**Handler logic** (sama dengan bridge, tapi jalan di dalam MITM proxy):
```js
async function handleNotion(req, bodyBuffer) {
  const isAiRequest = req.url.includes("aiProxy") || 
                      req.url.includes("runAsyncAITransaction");
  if (!isAiRequest) return passthrough(req, bodyBuffer);
  
  // Convert Notion request → OpenAI request
  const openaiBody = notionToOpenAI(bodyBuffer, req);
  
  // Forward ke 9router router (localhost:20128)
  const routerRes = await fetchRouter(openaiBody, "/v1/chat/completions");
  
  // Stream response balik ke Notion desktop
  return routerRes;
}
```

## Catatan keamanan

- Token `token_v2` disimpan lokal di `config.json` (chmod 600) atau DB 9router.
- Request Notion AI **harus streaming** supaya latency acceptable.
- Notion detect non-standard usage via:
  - Missing/invalid `notion-client-version`
  - Rate limit per workspace (hati-hati)
  - IP/geo anomalies
- **Untuk akun tumbal**: pakai workspace yang tidak kritikal.

## Model mapping

Notion display name → Notion internal model ID → OpenAI-compatible name:

| Notion UI | Internal model id (TBD) | OpenAI alias |
|---|---|---|
| Claude Opus 4.8 (max) | (capture) | `notion/opus-4.8` |
| GPT 5.5 | (capture) | `notion/gpt-5.5` |
| Claude Sonnet 4 | (capture) | `notion/sonnet-4` |

Internal model ID akan di-confirm setelah capture.
