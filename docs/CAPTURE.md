# Capture HTTPS Traffic Notion AI via DevTools

Notion desktop adalah Electron app — DevTools built-in bisa dibuka lewat
`Ctrl+Shift+I` (kadang `View → Toggle Developer Tools`). Dari situ kita bisa
lihat endpoint AI, headers, body, dan response.

## Langkah 1 — Buka DevTools

1. Pastikan **Notion desktop** sudah jalan dan kamu **sudah login** ke workspace
2. Klik di area kosong Notion (jangan di halaman yang ada AI, supaya tidak
   trigger request duluan)
3. Tekan **`Ctrl+Shift+I`**
4. Pindah ke tab **Network**
5. Centang **"Preserve log"** (supaya request tidak hilang saat reload)
6. Filter: ketik `ai` atau `notion` di kotak filter

## Langkah 2 — Trigger AI request

1. Buka halaman Notion **yang ada blok Notion AI** (atau klik tombol `Ask AI`)
2. Kirim prompt pendek, mis. "Halo, apa kabar?"
3. Tunggu sampai response AI muncul di halaman
4. Di DevTools Network, akan muncul beberapa request dengan path mengandung
   `ai`, `aiProxy`, `runAsync`, `completion`, atau `transactions`

## Langkah 3 — Identifikasi request AI yang benar

Dari daftar request, cari yang:
- **Method**: `POST`
- **URL**: `https://www.notion.so/api/v3/...` atau `https://app.notion.com/api/v3/...`
- **Status**: `200`
- **Size**: response > 1 KB (artinya ada konten AI)
- **Initiator**: `notion-ai` atau stack frame mengandung `ai`

Klik request itu. Di panel kanan, ambil:

### Headers (yang penting)

```
:authority: www.notion.so
:method: POST
:path: /api/v3/.......
content-type: application/json
x-notion-active-user-header: 376d872b-594c-8175-8c79-000207773147
x-notion-workspace-header: 78dddff2-b00e-814e-9e55-00030f79b66f
cookie: ... (akan panjang, salin semua)
notion-audit-log-platform: desktop
notion-client-version: ...
notion-api-version: ...
```

**Salin semua header**. Yang paling kritis:
- `cookie` (session token)
- `x-notion-active-user-header`
- `x-notion-workspace-header`
- `notion-client-version`
- `notion-api-version`

### Request Payload (tab "Payload" atau "Request")

Salin JSON body lengkap. Akan ada field seperti:
- `type` (mis. `"block"`, `"inline"`, atau nama action)
- `commands` atau `transaction` (isi request ke Notion)
- `surface`, `context`, dll

### Response (tab "Response" atau "Preview")

Salin JSON response. Biasanya berisi:
- `recordVal` atau `results` dengan block AI yang sudah terisi
- Streaming chunks (kalau pakai `text/event-stream` akan ada baris `data: {...}`)

## Langkah 4 — Cek apakah streaming

Di tab **Headers**, lihat `content-type` response:
- `application/json` → request biasa, semua response datang sekaligus
- `text/event-stream` → streaming (kita akan parse line `data: {json}`)

## Langkah 5 — Simpan hasil capture

Buat folder `capture/` di project ini, lalu save 3 file:

```bash
mkdir -p capture
```

Simpan sebagai:
- `capture/ai-request-headers.txt` — semua header dari request
- `capture/ai-request-body.json` — body request (JSON, pretty-print)
- `capture/ai-response-body.json` — body response (JSON, pretty-print)
- `capture/ai-response-stream.txt` — kalau streaming, full response body

## Langkah 6 — Ambil token (kalau mau skip DPAPI extractor)

Dari `cookie` header, cari cookie `token_v2=...` (nilai ini panjang, ~100
karakter, format `v03%3A...` atau `v03:` lalu base64-ish). Simpan ke
`capture/notion-token.txt` (1 baris, tanpa newline).

Field `token_v2` ini = session token yang dipakai untuk auth ke Notion API.

## Langkah 7 — Kirim hasil ke assistant

Setelah capture selesai, paste ke chat:
- Endpoint path exact (mis. `/api/v3/runAsyncAITransaction`)
- 1 baris header penting (`x-notion-client-version`, `notion-api-version`)
- 1 cuplikan kecil body request (50-100 baris pertama JSON)
- 1 cuplikan kecil body response (50-100 baris pertama JSON)
- `token_v2=...` (kalau sudah extract manual)

Dari situ saya akan:
1. Implement parser `openai-to-notion.js` dengan endpoint + format yang benar
2. Test bridge end-to-end
3. Tulis MITM handler `notion.js` untuk 9router

## Tips tambahan

- **Kalau ada banyak request AI** saat 1 prompt: yang pertama biasanya
  "create transaction", yang kedua "stream completion". Ambil **yang kedua**
  untuk lihat body completion.
- **Reload halaman Notion** sebelum capture supaya lebih bersih.
- **Gunakan workspace + user yang berbeda** (akun tumbal) untuk capture,
  supaya kalau kena limit tidak mengganggu workspace utama.
- **Notion kadang update endpoint** setiap 4-8 minggu. Kalau bridge tiba-tiba
  error, ulangi capture.
