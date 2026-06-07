# Notion AI via 9router — Research & Discovery Notes

> **TL;DR**: Notion AI adalah subscription-based chat yang berjalan via endpoint
> internal Notion (`www.notion.so/api/v3/...`), bukan API publik. Untuk
> expose-nya lewat 9router perlu reverse engineering + MITM session token.

## Yang sudah ditemukan

### Notion desktop info
- Versi: **7.20.0** (Electron)
- Install: `C:\Users\ollama\AppData\Local\Programs\Notion\`
- Data: `C:\Users\ollama\AppData\Roaming\Notion\`
  - `Local Storage/leveldb/` — session, cookies (DPAPI-encrypted)
  - `notion.db` — SQLite (schema tidak terdeteksi via `strings`)
  - `Local State` — berisi `os_crypt.encrypted_key` (Chrome safe storage key)
- user_id (dari log): `376d872b-594c-8175-8c79-000207773147`
- workspace_id (dari log): `78dddff2-b00e-814e-9e55-00030f79b66f`

### Notion production domains (dari `app.asar.unpacked/.webpack/main/index.js`)
- `https://www.notion.so` (DOMAIN_BASE_URLS, web app)
- `https://app.notion.com` (alternate)
- `https://api.notion.com` (PUBLIC API — untuk integrasi, BUKAN AI)
- `https://notion.site` (public pages)
- `https://identity.notion.so` / `https://identity.notion.com`
- `https://mail.notion.so` / `https://mail.notion.com`
- `https://calendar.notion.so`
- `https://www.notion.com`

### Endpoint API di bundle (sangat sedikit, kemungkinan besar ada di `@notionhq/shared-routes` yang tidak dibundle di main.js)
- `/api/v3/authValidate`
- `/api/v3/shouldDesktopRollback`
- Sisanya ada di shared library yang di-import di runtime

### 9router source
- Source: `C:\Users\ollama\9router-src` (clone, ada 9router-src 64 tags)
- MITM handlers existing: `antigravity`, `copilot`, `kiro`, `cursor`
- `TARGET_HOSTS` di `src/mitm/config.js`:
  - `daily-cloudcode-pa.googleapis.com`
  - `cloudcode-pa.googleapis.com`
  - `api.individual.githubcopilot.com`
  - `q.us-east-1.amazonaws.com`
  - `api2.cursor.sh`
- `URL_PATTERNS` per tool di config yang sama
- `getToolForHost()` di config yang sama
- Providers list di `src/shared/constants/providers.js`:
  - FREE: kiro (deprecated), opencode, gemini-cli (deprecated), qoder (deprecated)
  - FREE_TIER: openrouter, nvidia, ollama, vertex, gemini, cloudflare-ai, byteplus
  - OAUTH: claude (deprecated), antigravity (deprecated), codex (deprecated), github (deprecated), cursor, xai, kilocode, cline
  - APIKEY: glm, kimi, minimax, alicode, xiaomi-mimo, volcengine-ark, openai, vercel-ai-gateway, anthropic, opencode-go, azure, deepseek, commandcode, groq, xai, mistral, perplexity, together, fireworks, cerebras, cohere, nebius, siliconflow, hyperbolic, deepgram, assemblyai, nanobanana, elevenlabs, cartesia, playht, local-device, google-tts, edge-tts, coqui, tortoise, inworld, voyage-ai, sdwebui, comfyui, huggingface, blackbox, chutes
  - **Total 40+ provider** — Notion tidak ada

### Yang BELUM ditemukan
- Endpoint exact Notion AI (path: `/api/v3/...`)
- Format request body exact
- Format response (streaming atau bukan)
- Header yang wajib (selain `cookie`, `x-notion-active-user-header`, dll)
- Model id internal (mis. `anthropic-opus-4-8` atau yang lain)

### Cara pasti mengetahui
**Capture HTTPS Notion desktop pakai DevTools** (atau pakai flag
`--remote-debugging-port=9222` + Chrome ke `chrome://inspect`).

## Referensi (link yang harus dicek user)

- 9router source: https://github.com/decolua/9router
- Notion desktop 7.20.0: sudah di-extract untuk inspeksi JS bundle
- Notion dev tools: `Ctrl+Shift+I` di Notion desktop

## Caveat Penting

⚠️ **Risiko banned/limit Notion workspace** jika dipakai heavy sebagai agent.
Notion detect anomali via:
- IP / geo
- Request pattern (rate)
- Header fingerprint (notion-client-version mismatch)
- `notion-audit-log-platform` (jangan set ke non-desktop)

⚠️ **Endpoint AI bisa berubah** setiap 4-8 minggu saat Notion update. Capture
ulang kalau bridge tiba-tiba error.

⚠️ **Token expired** — token_v2 biasanya expire setelah 30-90 hari tidak aktif.
Re-capture dari DevTools kalau dapat 401.
