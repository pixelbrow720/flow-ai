/**
 * flow-setup.js — first-time setup for Notion-AI-Bridge.
 *
 * Launches Microsoft Edge (visible, not headless), navigates to app.notion.com,
 * waits for the user to log in, then captures:
 *   - browser.cookies   (all notion cookies as a header string)
 *   - notion.userId     (from notion_user_id cookie)
 *   - notion.workspaceId (intercepted from x-notion-space-id request header)
 * Generates a random apiKey and writes config.json in the project root.
 *
 * Usage:
 *   node flow-setup.js           (called by flow-setup.bat)
 */
import puppeteer from "puppeteer-core";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const DEFAULT_CLIENT_VERSION = "23.13.20260606.0807";
const DEFAULT_ENDPOINT = "https://app.notion.com/api/v3/runInferenceTranscript";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function findEdgePath() {
  for (const p of EDGE_PATHS) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function log(...a) {
  console.log(`[setup]`, ...a);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || "").trim());
    });
  });
}

function isUuidish(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    (s || "").trim()
  );
}

async function waitForLogin(page) {
  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    const cookies = await page.cookies();
    if (cookies.some((c) => c.name === "token_v2" && c.value)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function configureAgent(existing) {
  log("");
  log("---------------------------------------------------------------");
  log("  Custom agent (optional, recommended for coding agents)");
  log("---------------------------------------------------------------");
  log("A Notion custom agent lets the bridge use the AGENT'S OWN");
  log("instructions as the system prompt, instead of the built-in");
  log("'I am Notion AI' persona. This is the most reliable way to make");
  log("Notion act as a coding/agent backend (Kilo, Claude Code, ...).");
  log("");

  if (existing && existing.workflowId) {
    log(`Current agent workflowId: ${existing.workflowId}`);
    const keep = await ask("Keep this agent? (Y/n): ");
    if (keep.toLowerCase() !== "n") return existing;
  }

  const want = await ask("Configure a custom agent now? (y/N): ");
  if (want.toLowerCase() !== "y") {
    log("Skipping -- the bridge will run in plain Ask-AI mode.");
    log("Add one later by re-running setup or editing config.json");
    log("(see README -> Custom Agent Mode).");
    return undefined;
  }

  log("");
  log("STEP 1 -- make sure the agent exists in Notion:");
  log("  * Create a custom agent (e.g. 'Bridge Backend').");
  log("  * Give it instructions describing the backend/coding role.");
  log("  * Optionally Publish it for a stable (non-draft) version.");
  log("");
  log("STEP 2 -- grab its workflowId:");
  log("  * Open the agent, open DevTools (Ctrl+Shift+I) -> Network.");
  log("  * Send it any message; find the POST 'runInferenceTranscript'.");
  log("  * Copy the 'workflowId' value (a UUID) from the request body.");
  log("");

  let workflowId = "";
  while (!workflowId) {
    const v = await ask("Paste agent workflowId (blank to skip): ");
    if (!v) {
      log("Skipped -- plain Ask-AI mode.");
      return undefined;
    }
    if (isUuidish(v)) {
      workflowId = v;
    } else {
      log("That does not look like a UUID. Try again.");
    }
  }

  const ctx = await ask("Paste context page id (optional, blank to skip): ");
  const draftAns = await ask("Use the unpublished DRAFT version? (y/N): ");

  const agent = { workflowId };
  if (ctx && isUuidish(ctx)) agent.contextPageId = ctx;
  agent.useDraft = draftAns.toLowerCase() === "y";
  log("");
  log(`Agent configured: workflowId=${workflowId}, useDraft=${agent.useDraft}`);
  return agent;
}

async function main() {
  const edgePath = findEdgePath();
  if (!edgePath) {
    console.error(
      "ERROR: Microsoft Edge not found. Install from https://www.microsoft.com/edge"
    );
    process.exit(1);
  }

  const configPath = join(__dirname, "config.json");
  let existingConfig = null;
  if (existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      existingConfig = null;
    }
    log(`Existing config.json detected at ${configPath}`);
    log("Re-running setup REFRESHES your login (cookies + workspace) and");
    log("PRESERVES your existing apiKey and agent settings.");
  } else {
    log("No config.json found -- running first-time setup.");
  }

  const userDataDir = `C:\\Users\\${process.env.USERNAME || "User"}\\AppData\\Local\\Temp\\notion-bridge-setup-${Date.now()}`;

  log("Launching Edge (visible — you'll see the login window)...");
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: false,
    userDataDir,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();
  let workspaceId = null;
  page.on("request", (req) => {
    if (workspaceId) return;
    try {
      const h = req.headers();
      if (h["x-notion-space-id"]) {
        workspaceId = h["x-notion-space-id"];
        log(`Captured workspaceId from request: ${workspaceId}`);
      }
    } catch {}
  });

  log("Opening https://app.notion.com ...");
  try {
    await page.goto("https://app.notion.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    log(`Initial nav warning: ${e.message}`);
  }

  log("");
  log("===================================================");
  log("  >>> Log in to your Notion account in the Edge   <<<");
  log("  >>> window that just opened. The script will    <<<");
  log("  >>> auto-detect when you're done and capture    <<<");
  log("  >>> your workspace.                             <<<");
  log("===================================================");
  log("");

  log("Waiting for login (timeout: 5 min)...");
  const loggedIn = await waitForLogin(page);
  if (!loggedIn) {
    console.error("ERROR: Login timeout. Run flow-setup.bat again.");
    await browser.close();
    process.exit(1);
  }
  log("Login detected (token_v2 cookie present).");

  // Let the workspace load — it fires many /api/v3/ requests that carry
  // x-notion-space-id. Our request listener captures the first one.
  log("Loading workspace (5s)...");
  await new Promise((r) => setTimeout(r, 5000));

  if (!workspaceId) {
    // Force a navigation that triggers an API call with x-notion-space-id
    log("workspaceId not seen yet, navigating to home to force a request...");
    try {
      await page.goto("https://app.notion.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      log(`Forced nav warning: ${e.message}`);
    }
  }

  const cookies = await page.cookies();
  const userIdCookie = cookies.find((c) => c.name === "notion_user_id");
  if (!userIdCookie || !userIdCookie.value) {
    console.error(
      "ERROR: notion_user_id cookie not found. Are you sure you logged in?"
    );
    await browser.close();
    process.exit(1);
  }
  const userId = userIdCookie.value;

  if (!workspaceId) {
    console.error(
      "ERROR: Could not detect workspaceId from network requests."
    );
    console.error("Try logging in and clicking any page in your workspace, then re-run.");
    await browser.close();
    process.exit(1);
  }

  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  // Preserve an existing apiKey on refresh; otherwise mint a fresh one.
  const apiKey =
    existingConfig?.server?.apiKey ||
    `sk-bridge-${randomBytes(12).toString("hex")}`;

  const config = {
    ...(existingConfig || {}),
    notion: {
      ...(existingConfig?.notion || {}),
      endpoint: existingConfig?.notion?.endpoint || DEFAULT_ENDPOINT,
      userId,
      workspaceId,
      clientVersion:
        existingConfig?.notion?.clientVersion || DEFAULT_CLIENT_VERSION,
    },
    browser: {
      ...(existingConfig?.browser || {}),
      cookies: cookieString,
    },
    server: {
      host: existingConfig?.server?.host || "127.0.0.1",
      port: existingConfig?.server?.port || 8787,
      apiKey,
    },
  };

  // ── Custom-agent step ────────────────────────────────────────────────────
  // Optionally point the bridge at a Notion custom agent so the agent's own
  // instructions become the system prompt (overrides the built-in persona).
  delete config.agent;
  const agent = await configureAgent(existingConfig?.agent);
  if (agent && agent.workflowId) config.agent = agent;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  log("");
  log("===================================================");
  log("  Setup complete. config.json written.");
  log("===================================================");
  log(`  userId:      ${userId}`);
  log(`  workspaceId: ${workspaceId}`);
  log(`  apiKey:      ${apiKey}`);
  log(`  cookies:     ${cookies.length} cookies`);
  log(`  file:        ${configPath}`);
  log("");
  if (config.agent && config.agent.workflowId) {
    log(`  agent:       ${config.agent.workflowId} (custom-agent mode ON)`);
  } else {
    log("  agent:       (none -- plain Ask-AI mode)");
  }
  log("");
  log("  >>> Next step: double-click flow.bat to start the bridge. <<<");
  log("");

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e.stack || e.message);
  process.exit(1);
});
