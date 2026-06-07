# Notion AI via 9router — Research & Discovery Notes

> **TL;DR** (updated 2026-06-07): Notion AI adalah subscription-based chat
> yang berjalan via endpoint internal Notion (`app.notion.com/api/v3/...`),
> bukan API publik. Kita expose-nya lewat **Notion-AI-Bridge** (Node.js +
> Puppeteer + real Edge session cookies) yang serves OpenAI-compatible
> protocol di `http://127.0.0.1:8787/v1`. 9router tinggal add sebagai
> **OpenAI-compatible provider** dengan prefix (mis. `aurora/`). Tidak
> perlu MITM handler — bridge sudah jadi layer trust-rule-bypass.

## Yang sudah ditemukan (this session)

### Notion desktop info
- Versi: **7.20.0** (Electron)
- Install: `C:\Users\ollama\AppData\Local\Programs\Notion\`
- Data: `C:\Users\ollama\AppData\Roaming\Notion\`
  - `Local Storage/leveldb/` — session, cookies (DPAPI-encrypted)
  - `notion.db` — SQLite
  - `Local State` — berisi `os_crypt.encrypted_key`
- user_id (logged-in user): `376d872b-594c-8175-8c79-000207773147`
- workspaceId (default workspace): `78dddff2-b00e-814e-9e55-00030f79b66f`

### Notion production domains (dari `app.asar.unpacked/.webpack/main/index.js`)
- `https://www.notion.so` — web app (DOMAIN_BASE_URLS)
- `https://app.notion.com` — alternate web origin
- `https://api.notion.com` — **PUBLIC API** (untuk integrasi, BUKAN AI)
- `https://notion.site` — public pages
- `https://identity.notion.so` / `https://identity.notion.com`
- `https://mail.notion.so` / `https://mail.notion.com`
- `https://calendar.notion.so`
- `https://www.notion.com`

### Endpoint API (confirmed working dari capture 2026-06-06)
- `POST /api/v3/runInferenceTranscript` — **the AI endpoint** (uses
  `application/x-ndjson` response with `patch-sync` + `record-map` events)
- `POST /api/v3/getAvailableModels` — list 16+ models dengan metadata
  (model, modelMessage, modelFamily, displayGroup, beta flags)
- `POST /api/v3/getSpaces` — list user's workspaces + their space IDs
  (returns `user_root` + `space_view_pointers`)
- `POST /api/v3/syncRecordValues` — fetch full records (workspaces, pages,
  etc.) by `table:id` pointer
- `POST /api/v3/syncRecordValuesSpaceInitial` — initial sync of thread state
- `POST /api/v3/authValidate` — check session validity
- `POST /api/v3/registerDesktopApp` — heartbeat

### 16 model internal IDs (5 families)

Discovered via `getAvailableModels` 2026-06-07. The Notion server only
recognizes these internal model id strings. Anything else returns
`"Expected value to never occur: \"<X>\""` from `getThinkingConfig`.

| Notion UI label | Internal id                  | Family        | Tier       |
|-----------------|------------------------------|---------------|------------|
| Opus 4.8        | `ambrosia-tart-high`         | anthropic     | smart      |
| Opus 4.7        | `apricot-sorbet-high`        | anthropic     | smart      |
| Opus 4.6        | `avocado-froyo-medium`       | anthropic     | smart      |
| Sonnet 4.6      | `almond-croissant-low`       | anthropic     | fast       |
| Haiku 4.5       | `anthropic-haiku-4.5`        | anthropic     | nano       |
| GPT-5.5         | `opal-quince-medium`         | openai        | smart      |
| GPT-5.4         | `oval-kumquat-medium`        | openai        | fast       |
| GPT-5.4 Mini    | `oregon-grape-medium`        | openai        | nano       |
| GPT-5.4 Nano    | `otaheite-apple-medium`      | openai        | nano       |
| GPT-5.2         | `oatmeal-cookie`             | openai        | fast       |
| Gemini 3.1 Pro  | `galette-medium-thinking`    | gemini        | smart/thinking |
| Grok 4.3        | `xigua-mochi-medium`         | xai           | smart      |
| Grok Build 0.1  | `xinomavro-cake`             | xai           | smart      |
| DeepSeek V4 Pro | `baseten-deepseek-v4-pro`    | third-party   | smart      |
| Kimi K2.6       | `fireworks-kimi-k2.6`        | third-party   | fast       |
| MiniMax M2.5    | `fireworks-minimax-m2.5`     | third-party   | nano (intel:1 — avoid) |

**Naming pattern:** `{food}-{food}-{tier}` (or `{food}-{food}` with
implicit tier). The `-thinking` suffix enables extended reasoning (only
seen on Gemini so far). The `-high/-medium/-low` suffix picks within a
family.

**Only the workflow-supported subset** (those with `workflow.finalModelName`
flag set) work via `runInferenceTranscript`. Others require custom-agent
mode, which the bridge doesn't proxy.

### 9router integration — NOT via MITM, but via OpenAI-compatible provider

Source: `C:\Users\ollama\9router-src` (64 tags, MIT license). 9router has
existing MITM handlers for `antigravity`, `copilot`, `kiro`, `cursor`,
with `TARGET_HOSTS` for Google Cloud Code, Copilot, AWS CodeWhisperer,
and `api2.cursor.sh`. Adding Notion as a MITM target is theoretically
possible but unnecessary.

**40+ providers already in `src/shared/constants/providers.js`:** kiro,
opencode, gemini-cli, qoder, openrouter, nvidia, ollama, vertex, gemini,
cloudflare-ai, byteplus, claude, antigravity, codex, github, cursor, xai,
kilocode, cline, glm, kimi, minimax, alicode, xiaomi-mimo, volcengine-ark,
openai, vercel-ai-gateway, anthropic, opencode-go, azure, deepseek,
commandcode, groq, mistral, perplexity, together, fireworks, cerebras,
cohere, nebius, siliconflow, hyperbolic, deepgram, assemblyai,
nanobanana, elevenlabs, cartesia, playht, local-device, google-tts,
edge-tts, coqui, tortoise, inworld, voyage-ai, sdwebui, comfyui,
huggingface, blackbox, chutes. **Notion is NOT one of them.**

**Chosen integration path:** add Notion as a **custom OpenAI-compatible
provider** in 9router UI → "Add OpenAI Compatible":

| Field        | Value                                       |
|--------------|---------------------------------------------|
| Name         | `aurora`                                    |
| Prefix       | `aurora`                                    |
| API type     | `chat completions`                          |
| Base URL     | `http://127.0.0.1:8787/v1`                   |
| API Key      | `sk-bridge-...` (from `flow-setup.bat`)     |
| Model IDs    | `opus-4.8, opus-4.7, gpt-5.5, ...` (one per line) |

Then in user's AI agent: base URL = `http://127.0.0.1:20128/v1`, model =
`aurora/opus-4.8`. 9router strips the `aurora/` prefix and forwards to
the bridge.

### Why we use Puppeteer instead of raw fetch / MITM

Notion's `runInferenceTranscript` server has a trust rule
(`checkRunInferenceTranscriptRuleSet`) that rejects requests with
mismatched TLS/HTTP-2 fingerprint. Three bypass options, ranked:

1. **Puppeteer + Edge (chosen)** — launch real Chromium with the user's
   actual Notion cookies, do the `fetch()` from inside the page. Real
   TLS fingerprint + HTTP/2 fingerprint + header order match. Reliable.
2. **MITM proxy** — terminate TLS, replay with curl-like headers.
   Possible but complex (need root CA, cert generation, DNS override).
   Higher maintenance. Not built.
3. **Raw fetch with `Cookie` header from Node** — TLS fingerprint
   mismatches, trust rule denies. Fails. Don't bother.

### What was NOT needed from RESEARCH.md's original "Yang BELUM ditemukan"
The "BELUM" section from the old notes is now resolved:
- Endpoint exact → `/api/v3/runInferenceTranscript` ✓
- Request body format → JSON transcript (config + context + user events)
- Response format → `application/x-ndjson` with `patch-sync` and
  `record-map` events
- Headers needed → `x-notion-active-user-header`, `x-notion-space-id`,
  `notion-client-version`, Sentry baggage + trace, plus browser-injected
  defaults
- Model id internal → all 16 listed above

## Caveat Penting

⚠️ **Risiko banned/limit Notion workspace** jika dipakai heavy. Notion
detect anomali via IP/geo, request pattern, header fingerprint, dan
`notion-audit-log-platform`. Pakai workspace yang tidak kritikal untuk
eksperimen.

⚠️ **Cookies expire** — `token_v2` biasanya expire setelah beberapa
minggu tidak aktif. Re-run `flow-setup.bat` untuk refresh.

⚠️ **Bridge adalah STATELESS** — setiap call independen, gak ada memory
antar call. Context (journal, file excerpts, decisions) harus dikirim di
`messages`. Lihat `AGENT_SYSTEM_PROMPT.md` §1 untuk detail.

## Referensi

- 9router source: https://github.com/decolua/9router
- Notion desktop 7.20.0: sudah di-extract untuk inspeksi JS bundle
- Notion dev tools: `Ctrl+Shift+I` di Notion desktop (untuk debugging
  manual capture)
- Bridge `flow-setup.bat` (otomatis capture cookies, gak perlu DevTools)
- Bridge `flow-switch-workspace.bat` (list workspaces + plan, switch)
- Bridge `GET /v1/admin/notion-models` (live model list)
