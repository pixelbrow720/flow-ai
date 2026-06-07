# Capturing Notion AI Traffic — Historical / Manual Reference

> **Status: LEGACY.** The flow-setup.bat script automates everything
> described here. This document is kept as a reference for understanding
> what the bridge does under the hood, and for manual debugging if
> flow-setup.bat ever fails. You should NOT need to follow these steps
> manually — just run `.\flow-setup.bat`.

---

## What the bridge captures

When `flow-setup.bat` runs, it:

1. Launches a real Microsoft Edge (Chromium 148) via Puppeteer
2. Navigates to `https://app.notion.com`
3. Waits up to 5 minutes for you to log in (detects via `token_v2` cookie)
4. Captures:
   - `notion_user_id` cookie → `notion.userId`
   - All cookies as a header string → `browser.cookies`
   - `x-notion-space-id` from the first `/api/v3/...` request
     header → `notion.workspaceId`
5. Generates a random `sk-bridge-...` API key → `server.apiKey`
6. Writes `config.json`

For switching workspaces after initial setup, run `flow-switch-workspace.bat`.

---

## Manual capture (only if flow-setup.bat is broken)

If `flow-setup.bat` ever fails to capture the right values, you can do
it manually with Notion's DevTools. Useful for understanding what the
script does or for debugging.

### 1. Buka DevTools di Notion desktop

1. Pastikan **Notion desktop** sudah jalan dan kamu **sudah login** ke workspace
2. Klik di area kosong Notion
3. Tekan **`Ctrl+Shift+I`**
4. Pindah ke tab **Network**
5. Centang **"Preserve log"**
6. Filter: ketik `ai` atau `notion` di kotak filter

### 2. Trigger AI request

1. Buka halaman Notion **yang ada blok Notion AI** (atau klik tombol `Ask AI`)
2. Kirim prompt pendek, mis. "Halo, apa kabar?"
3. Tunggu sampai response AI muncul
4. Di DevTools Network, akan muncul request dengan path mengandung
   `runInferenceTranscript`, `getAvailableModels`, atau `getSpaces`

### 3. Identifikasi request yang benar

Cari yang:
- **Method**: `POST`
- **URL**: `https://www.notion.so/api/v3/...` atau `https://app.notion.com/api/v3/...`
- **Status**: `200`
- **Size**: response > 1 KB

Klik request itu. Di panel kanan, ambil:

#### Headers (yang penting)
```
x-notion-active-user-header: <userId>
x-notion-space-id:           <workspaceId>
notion-client-version:       23.13.20260606.0807  (or current)
notion-audit-log-platform:   web
cookie:                       <long string — the cookies>
```

Yang paling kritis: `cookie` (full string), `x-notion-active-user-header`,
`x-notion-space-id`, `notion-client-version`.

#### Response (untuk verifikasi)

- `application/x-ndjson` → line-delimited JSON events. Cari yang
  `type: "agent-inference"` di `recordMap.thread_message` — itu text
  panjang dari AI.

### 4. Format config.json manual

Setelah dapet values, edit `config.json`:

```json
{
  "notion": {
    "endpoint": "https://app.notion.com/api/v3/runInferenceTranscript",
    "userId": "PASTE_USER_ID_HERE",
    "workspaceId": "PASTE_WORKSPACE_ID_HERE",
    "clientVersion": "PASTE_VERSION_HERE"
  },
  "browser": {
    "cookies": "PASTE_FULL_COOKIE_STRING_HERE"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787,
    "apiKey": "sk-bridge-CHANGE_ME_TO_RANDOM"
  }
}
```

Then run `flow.bat` to start the bridge.

---

## Tips tambahan

- **Kalau ada banyak request AI** saat 1 prompt: yang pertama biasanya
  "config accept", yang kedua "record-map sync". Cari yang response-nya
  > 1 KB.
- **Reload halaman Notion** sebelum capture supaya lebih bersih.
- **Gunakan workspace + user yang berbeda** (akun tumbal) untuk capture,
  supaya kalau kena limit tidak mengganggu workspace utama.
- **Notion kadang update endpoint** setiap 4-8 minggu. Capture ulang
  (atau re-run flow-setup.bat) kalau bridge tiba-tiba error.
- **bridge `flow-switch-workspace.bat`** lebih cepat daripada re-capture
  penuh — pakai itu untuk ganti workspace, bukan re-run flow-setup.

## Yang TIDAK boleh di-capture manual

- ❌ Jangan set `User-Agent`, `Referer`, atau `Cookie` di header manual —
  ini "forbidden header names" di browser, di-drop silently. Cukup
  biarkan browser inject dari session.
- ❌ Jangan set `Content-Type` manual selain `application/json` di
  `runInferenceTranscript` — Notion validate dan reject kalo beda.
- ❌ Jangan pakai `fetch` dari Node.js tanpa puppeteer — trust rule
  reject karena TLS fingerprint mismatch.
