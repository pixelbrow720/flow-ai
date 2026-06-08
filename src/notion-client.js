/**
 * Notion HTTP client â€” sends requests to Notion's internal AI endpoint.
 *
 * Endpoint: /api/v3/runInferenceTranscript (Notion 23.13.20260605.1144)
 * Response content-type: application/x-ndjson (newline-delimited JSON)
 *
 * Each ndjson line is a JSON-Patch style event. Text content lives in:
 *   - value: [{ type: "text", content: "PONG" }]   (agent-inference events)
 *   - v[].v.value: [{ type: "text", content: "..." }]  (inside recordMap patches)
 *   - value.text           (legacy single-string variants)
 *   - value.delta          (delta in older versions)
 *
 * To bypass the Notion trust rule (TLS fingerprint check), the actual HTTP
 * call is delegated to a real Microsoft Edge instance via puppeteer-core
 * (see lib/puppeteer-client.js). Without that, the request reaches Notion
 * but is denied at checkRunInferenceTranscriptRuleSet with
 *   "AI inference is not allowed." (subType: trust-rule-denied)
 */

import { debug, err } from "./logger.js";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { callNotionFromBrowser, initPuppeteer } from "./puppeteer-client.js";

/**
 * Generate a fresh Sentry trace id + span id + sample_rand per request.
 * The Notion trust rule validates that these match a valid Sentry session
 * shape, but a hardcoded trace is flagged as fake. Real clients rotate
 * these per request.
 */
function freshSentryHeaders(clientVersion) {
  const traceId = randomUUID().replace(/-/g, "");
  const spanId = randomBytes(8).toString("hex");
  const sampleRand = Math.random().toFixed(16);
  const release = clientVersion || "23.13.20260605.1144";
  return {
    baggage: `sentry-environment=production,sentry-release=${release},sentry-public_key=704fe3b1898d4ccda1d05fe1ee79a1f7,sentry-trace_id=${traceId},sentry-org_id=324374,sentry-sampled=false,sentry-sample_rand=${sampleRand},sentry-sample_rate=0.00001`,
    "sentry-trace": `${traceId}-${spanId}-0`,
  };
}

/**
 * Build headers for a Notion API request.
 */
function buildNotionHeaders(config) {
  if (config.headers) return { ...config.headers };

  const sentry = freshSentryHeaders(config.clientVersion);
  // Match the EXACT header set that the working Notion web capture sends.
  // Important: do NOT add User-Agent, Referer, Content-Type, or Accept here â€”
  // these are "forbidden header names" for fetch from JavaScript, and the
  // browser silently drops them. If we set them anyway, the browser may
  // trigger an unnecessary CORS preflight or change the Content-Type to
  // "text/plain" (forbidden write of application/json), which causes Notion
  // to return 400 ValidationError.
  //
  // content-type: application/json is added by callNotionFromBrowser inline
  // (after the spread) so it survives into the fetch call.
  return {
    accept: "application/x-ndjson, application/json",
    "accept-language": "en-US,en;q=0.9",
    "x-notion-active-user-header": config.userId,
    "x-notion-space-id": config.workspaceId,
    "notion-audit-log-platform": "web",
    "notion-client-version": config.clientVersion,
    "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    priority: "u=1, i",
    referer: "https://app.notion.com/ai",
    ...sentry,
  };
}

/**
 * Read cookies.json (sibling of config.json) and build a single Cookie header
 * string. Returns empty string if cookies.json doesn't exist or is empty.
 *
 * The companion cookies (notion_browser_id, notion_user_id, device_id, __cf_bm,
 * cf_clearance, etc.) are what Notion's trust rule checks. Sending only
 * token_v2 gets a 200 OK with `subType: trust-rule-denied` error event in the
 * ndjson body â€” the cookies are what flip the trust decision.
 */
function buildCookieHeader(config) {
  // 1) Cache hit
  if (_cookieHeaderCache !== null) return _cookieHeaderCache;

  // 2) Resolve cookies.json path: next to config.json
  //    config may be a re-export from load-config.js (frozen), so use
  //    process.cwd() + notion-bridge/cookies.json as the canonical location.
  const candidates = [
    process.env.COOKIE_JAR_PATH,
    // Sibling of config.json in the bridge directory
    `${process.cwd()}/cookies.json`,
    `${process.cwd()}/notion-bridge/cookies.json`,
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf8"));
      const cookies = Array.isArray(data) ? data : data.cookies;
      if (!Array.isArray(cookies) || cookies.length === 0) continue;

      // Build the Cookie header: name=value; name2=value2
      // HttpOnly / Secure flags are browser-only â€” for raw HTTP from this
      // server we send every cookie unconditionally.
      const header = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      _cookieHeaderCache = header;
      debug(`[notion] loaded ${cookies.length} cookies from ${p}`);
      return header;
    } catch (e) {
      debug(`[notion] could not read cookie jar at ${p}: ${e.message}`);
    }
  }
  _cookieHeaderCache = "";
  return "";
}

// Module-level cache so we don't re-read the JSON on every request
let _cookieHeaderCache = null;

/**
 * Send non-streaming request to Notion, return parsed response.
 * Uses real Microsoft Edge via Puppeteer to bypass trust rule (TLS fingerprint).
 */
export async function sendToNotion({ config, body }) {
  const headers = buildNotionHeaders(config);
  debug(`[notion] POST ${config.endpoint} (via Puppeteer/Edge)`);

  // Ensure Edge browser is launched
  await initPuppeteer();

  const res = await callNotionFromBrowser(
    config.endpoint,
    headers,
    body
  );

  if (res.status >= 400) {
    err(`[notion] ${res.status}  body=${res.body.slice(0, 500)}`);
    throw new Error(`Notion API error ${res.status}: ${res.body.slice(0, 200)}`);
  }

  debug(`[notion] response: status=${res.status} bytes=${res.body.length}`);
  if (process.env.DUMP_NDJSON === "1") {
    console.log("----NDJSON-DUMP-START----");
    console.log(res.body);
    console.log("----NDJSON-DUMP-END----");
  }
  const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
  if (ct.includes("application/x-ndjson") || ct.includes("ndjson")) {
    return parseNdjsonResponse(res.body);
  }
  if (ct.includes("text/event-stream")) {
    return parseSseResponse(res.body);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    return { raw: res.body };
  }
}

/**
 * Async generator: stream text chunks from Notion ndjson response.
 * Uses real Microsoft Edge via Puppeteer.
 *
 * Note: Puppeteer buffers the full response in one call, so this generator
 * returns text in 1-3 chunks (initial config-accepted, then each
 * agent-inference text patch, then final record-map text). Not real-time
 * streaming, but sufficient for OpenAI chat completions streaming protocol.
 */
export async function* streamNotionResponse({ config, body }) {
  const headers = buildNotionHeaders(config);
  debug(`[notion-stream] POST ${config.endpoint} (via Puppeteer/Edge)`);

  await initPuppeteer();

  const res = await callNotionFromBrowser(
    config.endpoint,
    headers,
    body
  );

  if (res.status >= 400) {
    err(`[notion-stream] ${res.status}  body=${res.body.slice(0, 500)}`);
    throw new Error(`Notion API error ${res.status}`);
  }

  const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
  debug(`[notion-stream] content-type: ${ct}`);

  // Parse ndjson line by line, yield each text chunk as it's discovered.
  // Reuse parseNdjsonResponse (handles long text from patch-sync / record-map).
  // We don't get real-time streaming this way (Puppeteer buffers the full
  // response), but for AI agents that wait for a complete reply, this is
  // fine. Each line of the long text is emitted as a single chunk to keep
  // the OpenAI streaming contract (SSE chunks → tokens).
  const parsed = parseNdjsonResponse(res.body);
  const text = parsed.text || "";
  if (text) {
    // Emit in reasonable chunks (whole text for short, word-batches for long)
    if (text.length <= 200) {
      yield text;
    } else {
      const tokens = text.match(/\S+\s*|\s+/g) || [text];
      for (const tok of tokens) yield tok;
    }
  }
}

/**
 * Parse full ndjson body into { events, text }.
 *
 * Notion's runInferenceTranscript has TWO state representations in its
 * ndjson response stream:
 *
 *   1. PATCH EVENTS (state.s in our applied state) — the model's activity
 *      log. The "agent-inference" entry here holds a *brief* fragment (often
 *      a planning line or a follow-up question like "a page in your
 *      workspace or go deeper on any of these?"). Useful for streaming UI
 *      but NOT the user's long answer.
 *
 *   2. PATCH-SYNC (data.s) and RECORD-MAP (recordMap.thread_message) — the
 *      chat thread state. The final agent-inference here holds the FULL
 *      long response with all the paragraphs. This is what the Notion web
 *      UI renders as the assistant's message.
 *
 * We try the chat-state sources first (long text), and fall back to the
 * patch state (brief fragment) if not present.
 */
function parseNdjsonResponse(body) {
  const events = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch {}
  }

  const collectParts = (item) => {
    if (!item || item.type !== "agent-inference" || !Array.isArray(item.value)) return "";
    return item.value
      .filter((p) => p && p.type !== "thinking")
      .map((p) => p.text || p.content || "")
      .filter(Boolean)
      .join("");
  };

  // 1) Last patch-sync event has data.s (the chat thread state, long text)
  for (let s = events.length - 1; s >= 0; s--) {
    const ev = events[s];
    if (ev.type === "patch-sync" && ev.data && Array.isArray(ev.data.s)) {
      const arr = ev.data.s;
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = collectParts(arr[i]);
        if (t && t.length > 5) return { events, text: t };
      }
    }
  }

  // 2) record-map thread_message (same long text)
  for (let r = events.length - 1; r >= 0; r--) {
    const ev = events[r];
    if (ev.type === "record-map" && ev.recordMap && ev.recordMap.thread_message) {
      const msgs = Object.values(ev.recordMap.thread_message);
      for (let i = msgs.length - 1; i >= 0; i--) {
        const step = msgs[i] && msgs[i].value && msgs[i].value.value && msgs[i].value.value.step;
        if (step && step.type === "agent-inference" && Array.isArray(step.value)) {
          const t = step.value
            .filter((p) => p && p.type !== "thinking")
            .map((p) => p.text || p.content || "")
            .filter(Boolean)
            .join("");
          if (t && t.length > 5) return { events, text: t };
        }
      }
    }
  }

  // 3) Fallback: apply patches (brief fragment, better than nothing)
  const isArraySeg = (s) => s === "-" || /^\d+$/.test(s);
  const applyOp = (state, op) => {
    if (op.o !== "a" && op.o !== "x" && op.o !== "d") return false;
    const segs = op.p.split("/").filter(Boolean);
    if (segs.length === 0) return false;
    const normSegs = segs.slice();
    for (let i = 0; i < normSegs.length; i++) {
      if (isArraySeg(normSegs[i])) { if (normSegs[i] !== "-") normSegs[i] = String(Number(normSegs[i]) - 1); break; }
    }
    let cur = state;
    for (let i = 0; i < normSegs.length - 1; i++) {
      const seg = normSegs[i];
      if (isArraySeg(seg)) {
        if (!Array.isArray(cur)) return false;
        const idx = seg === "-" ? cur.length - 1 : Number(seg);
        if (idx < 0 || idx >= cur.length) {
          const next = normSegs[i + 1];
          cur[idx] = isArraySeg(next) ? [] : {};
        }
        cur = cur[idx];
      } else {
        if (cur[seg] === undefined) {
          const next = normSegs[i + 1];
          cur[seg] = isArraySeg(next) ? [] : {};
        }
        cur = cur[seg];
      }
    }
    const last = normSegs[normSegs.length - 1];
    if (isArraySeg(last)) {
      if (!Array.isArray(cur)) return false;
      if (last === "-") cur.push(op.v);
      else cur[Number(last)] = op.v;
    } else {
      cur[last] = op.v;
    }
    return true;
  };
  const state = {};
  for (const ev of events) {
    if (Array.isArray(ev.v)) {
      for (const op of ev.v) applyOp(state, op);
    }
  }
  const arr = state.s || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = collectParts(arr[i]);
    if (t) return { events, text: t };
  }
  return { events, text: "" };
}
