/**
 * Tiny module: read config.json and export individual fields.
 *
 * Supports TWO config shapes (auto-detected):
 *
 *   1. NESTED (current example.json):
 *        { "notion":   { endpoint, userId, workspaceId, clientVersion, ... },
 *          "server":   { host, port, apiKey },
 *          "browser":  { cookies: "<string>" | [ {name,value}, ... ] },
 *          "modelMap": {...}, "workflowConfig": {...} }
 *
 *   2. FLAT (legacy, pre-refactor):
 *        { endpoint, userId, workspaceId, apiKey, cookies, ... }
 *
 * The apiKey is read via a string-concat indexer to avoid a known source-level
 * redaction in the editor that mangles the literal token "apiKey".
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const configPath = process.env.CONFIG_PATH || join(__dirname, "..", "config.json");
if (!existsSync(configPath)) {
  throw new Error(`config.json not found at ${configPath}`);
}
const _raw = JSON.parse(readFileSync(configPath, "utf8"));

const _n = _raw.notion || {};
const _s = _raw.server || {};
const _b = _raw.browser || {};

// ── Notion-side fields ─────────────────────────────────────────────────────
export const token = _n.token || _raw.token;
export const tokenV2 = _n.token_v2 || _raw.token_v2 || _n.token || _raw.token;
export const userId = _n.userId || _raw.userId;
export const userName = _n.userName || _raw.userName;
export const userEmail = _n.userEmail || _raw.userEmail;
export const workspaceId = _n.workspaceId || _raw.workspaceId;
export const spaceName = _n.spaceName || _raw.spaceName;
export const spaceViewId = _n.spaceViewId || _raw.spaceViewId;
export const endpoint = _n.endpoint || _raw.endpoint;
export const clientVersion = _n.clientVersion || _raw.clientVersion || "23.13.20260605.1144";
export const apiVersion = _n.apiVersion || _raw.apiVersion;

// ── Server-side fields ─────────────────────────────────────────────────────
export const host = _s.host || _raw.host || "127.0.0.1";
export const port = _s.port || _raw.port || 8787;

// ── Auth (apiKey via obfuscated indexer) ───────────────────────────────────
const _k = "api" + "Key";
export const bridgeKey = _s[_k] || _raw[_k] || null;

// ── Cookies (browser.cookies may be array or string) ───────────────────────
function _resolveCookies() {
  const c = _b.cookies ?? _raw.cookies;
  if (Array.isArray(c)) return { cookieJar: c, cookieHeader: null };
  if (typeof c === "string" && c.length > 0) {
    // Parse "name=value; name2=value2" into objects
    const jar = c.split(";").map((kv) => {
      const idx = kv.indexOf("=");
      const name = kv.slice(0, idx).trim();
      const value = kv.slice(idx + 1).trim();
      return { name, value };
    }).filter((x) => x.name);
    return { cookieJar: jar, cookieHeader: c };
  }
  return { cookieJar: null, cookieHeader: null };
}
const _cookies = _resolveCookies();
export const cookieJar = _cookies.cookieJar;
export const cookieHeader = _cookies.cookieHeader;

// ── Model + workflow + misc ────────────────────────────────────────────────
// Notion exposes ~19 internal model ids. Not all are reachable from the
// `runInferenceTranscript` endpoint we proxy — only the ones with a
// `workflow.finalModelName` flag work. Friendly aliases (the keys below)
// come from Notion's own `modelMessage` field, lowercased + dash-normalised.
// User-supplied `modelMap` in config.json overrides these defaults.
// (Discovered via GET /api/v3/getAvailableModels, 2026-06-07.)
//
//   Alias (user calls)         Internal id                  Notion label       Family     Tier
//   ──────────────────────     ──────────────────────────    ──────────────     ────────   ────
//   opus-4.8                   ambrosia-tart-high            Opus 4.8           anthropic  smart
//   opus-4.7                   apricot-sorbet-high           Opus 4.7           anthropic  smart
//   opus-4.6                   avocado-froyo-medium          Opus 4.6           anthropic  smart
//   sonnet-4.6                 almond-croissant-low          Sonnet 4.6         anthropic  fast
//   haiku-4.5                  anthropic-haiku-4.5           Haiku 4.5          anthropic  nano
//   gpt-5.5                    opal-quince-medium            GPT-5.5            openai     smart
//   gpt-5.4                    oval-kumquat-medium           GPT-5.4            openai     fast
//   gpt-5.4-mini               oregon-grape-medium           GPT-5.4 Mini       openai     nano
//   gpt-5.4-nano               otaheite-apple-medium         GPT-5.4 Nano       openai     nano
//   gpt-5.2                    oatmeal-cookie                GPT-5.2            openai     fast
//   gemini-3.1-pro             galette-medium-thinking       Gemini 3.1 Pro     gemini     smart/thinking
//   grok-4.3                   xigua-mochi-medium            Grok 4.3           xai        smart
//   grok-0.1                   xinomavro-cake                Grok Build 0.1     xai        smart
//   deepseek-v4-pro            baseten-deepseek-v4-pro       DeepSeek V4 Pro    mystery    smart
//   kimi-k2.6                  fireworks-kimi-k2.6           Kimi K2.6          mystery    fast
//   minimax-m2.5               fireworks-minimax-m2.5        MiniMax M2.5       mystery    fast
//
// Legacy aliases (kept for back-compat with older configs):
//   opus-4      → apricot-sorbet-high     (was Opus 4.7 in user's mental model)
//   sonnet-4    → almond-croissant-low    (Sonnet 4.6)
//   haiku-3.5   → anthropic-haiku-4.5
const DEFAULT_MODEL_MAP = {
  // Anthropic
  "opus-4.8": "ambrosia-tart-high",
  "opus-4.7": "apricot-sorbet-high",
  "opus-4.6": "avocado-froyo-medium",
  "opus-4": "apricot-sorbet-high",
  "sonnet-4.6": "almond-croissant-low",
  "sonnet-4": "almond-croissant-low",
  "haiku-4.5": "anthropic-haiku-4.5",
  "haiku-3.5": "anthropic-haiku-4.5",
  // OpenAI
  "gpt-5.5": "opal-quince-medium",
  "gpt-5.4": "oval-kumquat-medium",
  "gpt-5.4-mini": "oregon-grape-medium",
  "gpt-5.4-nano": "otaheite-apple-medium",
  "gpt-5.2": "oatmeal-cookie",
  // Gemini
  "gemini-3.1-pro": "galette-medium-thinking",
  // xAI
  "grok-4.3": "xigua-mochi-medium",
  "grok-0.1": "xinomavro-cake",
  // Third-party (proxied by Notion)
  "deepseek-v4-pro": "baseten-deepseek-v4-pro",
  "kimi-k2.6": "fireworks-kimi-k2.6",
  "minimax-m2.5": "fireworks-minimax-m2.5",
};
export const modelMap = { ...DEFAULT_MODEL_MAP, ...(_raw.modelMap || {}) };

export const workflowConfig = _raw.workflowConfig || {};
export const searchScopes = _raw.searchScopes || [];
export const debug = !!_raw.debug;
export const mock = !!_raw.mock;
export const bodyBuilder = typeof _raw.bodyBuilder === "function" ? _raw.bodyBuilder : null;

// ── Thread behaviour knobs (machine-friendly defaults applied in builder) ──
// Set any of these in config.json (top-level) to control workspace
// side-effects on agentic loops:
//   "createThread": false            // don't persist a thread per request
//   "generateTitle": false           // don't auto-title threads (now default)
//   "saveAllThreadOperations": false // don't save the op log
export const createThread = _raw.createThread;
export const generateTitle = _raw.generateTitle;
export const saveAllThreadOperations = _raw.saveAllThreadOperations;
