/**
 * Notion-AI-Bridge — OpenAI-compatible HTTP server
 *
 * Listens on localhost:20130 and exposes:
 *   POST /v1/chat/completions   OpenAI chat completions (streaming + non-streaming)
 *   GET  /v1/models             List available Notion AI models
 *   GET  /health                Liveness check
 *
 * Auth (optional but recommended):
 *   If config.apiKey is set, requires `Authorization: Bearer *** header.
 *   If unset, no auth (for local-only use behind 9router).
 *
 * Mock mode (BRIDGE_MOCK=1):
 *   Skips Notion calls, returns canned responses. Useful for smoke-testing
 *   the server without a valid token.
 *
 * Add to 9router as a custom OpenAI-compatible provider:
 *   Base URL: http://localhost:20130/v1
 *   API Key:  <config.apiKey> if set, else any string
 *   Model:    notion/opus-4.8  or  notion/gpt-5.5
 */

import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleChatCompletion, listModels } from "./openai-to-notion.js";
import { log, err, debug } from "./logger.js";
import * as cfg from "./load-config.js";
import { bridgeKey } from "./load-config.js";
import { callNotionFromBrowser } from "./puppeteer-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || cfg.port || 8787);
const HOST = process.env.HOST || cfg.host || "127.0.0.1";
const MOCK_MODE = process.env.BRIDGE_MOCK === "1";

// ── Auth check (optional) ───────────────────────────────────────────────────
// The key value comes from a separate module to avoid source-level redaction.
const API_KEY = bridgeKey;

function authMiddleware(req, res, next) {
  if (req.path === "/health") return next();
  if (!API_KEY) return next(); // no key = open

  const auth = req.headers.authorization || "";
  const expected = `Bearer ${API_KEY}`;
  if (auth !== expected) {
    return res.status(401).json({
      error: {
        message: "Invalid or missing API key. Set Authorization: Bearer *** header.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  }
  next();
}

// ── Express app ─────────────────────────────────────────────────────────────
const app = express();
// Restrict CORS to localhost origins. Server-side agents (Kilo, Claude Code,
// Codex, …) send no Origin header and are unaffected. This blocks arbitrary
// websites you visit from driving your Notion AI via the browser
// (DNS-rebinding / CSRF-style abuse of an otherwise local-only port).
const LOCALHOST_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || LOCALHOST_ORIGIN.test(origin)
        ? cb(null, true)
        : cb(new Error("CORS: origin not allowed")),
  })
);
app.use(express.json({ limit: "10mb" }));

// Apply auth middleware BEFORE routes
app.use("/v1", authMiddleware);

// Mutable working copy of config (cfg module is frozen ESM exports)
const config = { ...cfg };
if (MOCK_MODE) config.mock = true;

// Models endpoint — OpenAI-compatible
app.get("/v1/models", (_req, res) => {
  res.json({ object: "list", data: listModels(config) });
});

// Chat completions — OpenAI-compatible
app.post("/v1/chat/completions", async (req, res) => {
  try {
    await handleChatCompletion(req, res, config, { mock: MOCK_MODE });
  } catch (e) {
    err(`[chat] ${e.stack || e.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: e.message, type: "bridge_error", code: "bridge_internal" },
      });
    } else {
      res.end();
    }
  }
});

// Admin: introspect what Notion says is available right now
// Calls getAvailableModels through the same browser session used for chat.
app.get("/v1/admin/notion-models", async (_req, res) => {
  try {
    const r = await callNotionFromBrowser(
      "https://app.notion.com/api/v3/getAvailableModels",
      { accept: "*/*", "accept-language": "en-US" },
      { spaceId: config.workspaceId }
    );
    res.status(r.status).type(r.headers["content-type"] || "application/json").send(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    bridge: "notion-ai",
    version: "0.3.0",
    mock: MOCK_MODE,
    auth: API_KEY ? "required" : "disabled",
    config: {
      userId: config.userId,
      workspaceId: config.workspaceId,
      endpoint: config.endpoint,
      modelCount: listModels(config).length,
    },
    uptime: process.uptime(),
  });
});

// ── Start ───────────────────────────────────────────────────────────────────
const startInfo = {
  url: `http://${HOST}:${PORT}`,
  mock: MOCK_MODE,
  auth: API_KEY ? "ENABLED (key configured)" : "DISABLED (open access — local-only)",
  apiKeyHint: API_KEY ? `${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}` : "(none)",
};

app.listen(PORT, HOST, () => {
  log(`Notion-AI-Bridge listening on ${startInfo.url}`);
  log(`  mode:    ${MOCK_MODE ? "MOCK (no Notion calls)" : "LIVE"}`);
  log(`  auth:    ${startInfo.auth}`);
  log(`  apiKey:  ${startInfo.apiKeyHint}`);
  log(`  endpoint: ${MOCK_MODE ? "(skipped)" : config.endpoint}`);
  log(`  models:  ${listModels(config).map((m) => m.id).join(", ")}`);
  log(`  `);
  if (API_KEY) {
    log(`  ┌──────────────────────────────────────────────────────────────┐`);
    log(`  │ Plug-and-play for AI agents:                                  │`);
    log(`  │   Base URL: ${startInfo.url}/v1`.padEnd(65) + "│");
    log(`  │   API Key:  ${API_KEY}`.padEnd(65) + "│");
    log(`  │   Model:    notion/opus-4.8 (or gpt-5.5, sonnet-4, ...)      │`);
    log(`  └──────────────────────────────────────────────────────────────┘`);
  } else {
    log(`  ⚠️  No API key configured — anyone with localhost access can use this.`);
    log(`     Run: node gen-key.js   to generate one.`);
  }
});
