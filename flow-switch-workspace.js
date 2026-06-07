/**
 * flow-switch-workspace.js — switch which Notion workspace the bridge targets.
 *
 * Reads the cookies from config.json, opens a headless Edge, calls Notion's
 * `getSpaces` API to list the user's workspaces with their plan + AI status,
 * shows a numbered picker, updates config.json to the chosen workspace, and
 * (if the bridge is currently running) restarts it.
 *
 * Called by flow-switch-workspace.bat. Also runnable directly: `node flow-switch-workspace.js`.
 */
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "config.json");

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

// Plans known to have Notion AI. If a plan is missing from this list, it
// is treated as "no AI". Add to this set if Notion rolls out a new tier.
const PLANS_WITH_AI = new Set([
  "personal",
  "personal_pro",
  "team",
  "business",
  "business_trial",
  "enterprise",
]);

function findEdgePath() {
  for (const p of EDGE_PATHS) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function log(...a) {
  console.log(`[switch]`, ...a);
}

function parseCookies(cookieString) {
  return cookieString
    .split(";")
    .map((kv) => {
      const idx = kv.indexOf("=");
      return { name: kv.slice(0, idx).trim(), value: kv.slice(idx + 1).trim() };
    })
    .filter((c) => c.name);
}

function shapeCookies(cookies) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    url: "https://app.notion.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: c.name === "token_v2" ? "None" : "Lax",
  }));
}

function describePlan(space) {
  const planType = (space.plan_type || "unknown").replace(/_/g, " ");
  const subTier = space.subscription_tier;
  const hasAiFlag = space.settings?.enable_ai_feature;
  const trialEnd = space.trial_end;
  const overrideCredit = space.settings?.override_credit_limit?.[0];

  let desc = planType;
  if (subTier && subTier !== space.plan_type) {
    desc += ` (tier: ${subTier})`;
  }
  if (trialEnd) {
    const daysLeft = Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000));
    desc += ` - trial ${daysLeft}d left`;
  }
  if (overrideCredit) {
    const start = new Date(overrideCredit.periodStartMs);
    const end = new Date(overrideCredit.periodEndMs);
    const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
    desc += ` - credit override: ${overrideCredit.limit} (${daysLeft}d left, ends ${end.toISOString().slice(0, 10)})`;
  }
  const hasAi =
    typeof hasAiFlag === "boolean"
      ? hasAiFlag
      : PLANS_WITH_AI.has(space.plan_type);
  desc += hasAi ? " - AI enabled" : " - no AI";
  return desc;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function fetchSpaces(cookies) {
  const edgePath = findEdgePath();
  if (!edgePath) throw new Error("Microsoft Edge not found");

  const userDataDir = `C:\\Users\\${
    process.env.USERNAME || "User"
  }\\AppData\\Local\\Temp\\notion-bridge-switch-${Date.now()}`;
  log("Launching Edge (one-shot) ...");

  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: "new",
    userDataDir,
    args: [
      "--no-sandbox",
      "--no-first-run",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const ctx = browser.defaultBrowserContext();
    await ctx.setCookie(...shapeCookies(cookies));
    const page = await browser.newPage();
    await page.goto("https://app.notion.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    // Step 1: get list of space IDs (and confirm the user is logged in)
    const listResult = await page.evaluate(async () => {
      const r = await fetch("/api/v3/getSpaces", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100, offset: 0 }),
      });
      const j = await r.json();
      const userId = j && Object.keys(j)[0];
      const ptrs = j?.[userId]?.user_root?.[userId]?.value?.value?.space_view_pointers || [];
      return { userId, spaceIds: ptrs.map((p) => p.spaceId).filter(Boolean) };
    });

    if (!listResult.userId) {
      throw new Error("getSpaces returned no user — cookies may be invalid");
    }
    if (listResult.spaceIds.length === 0) {
      throw new Error("getSpaces returned no workspaces for this user");
    }

    // Step 2: fetch full space records (name, plan, AI, icon, trial_end, etc.)
    const recordMap = await page.evaluate(async (spaceIds) => {
      const r = await fetch("/api/v3/syncRecordValues", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: spaceIds.map((id) => ({
            pointer: { table: "space", id },
            version: -1,
          })),
          spaceId: spaceIds[0],
        }),
      });
      const j = await r.json();
      return j?.recordMap?.space || {};
    }, listResult.spaceIds);

    // Flatten to an array of space records, preserving the order from the pointer list
    const spaces = listResult.spaceIds
      .map((id) => recordMap?.[id]?.value?.value)
      .filter(Boolean);

    return spaces;
  } finally {
    await browser.close();
  }
}

function isBridgeRunning() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { 'YES' } else { 'NO' }"`,
      { encoding: "utf8" }
    ).trim();
    return out === "YES";
  } catch {
    return false;
  }
}

function killBridge() {
  const pidPath = join(__dirname, "bridge.pid");
  if (!existsSync(pidPath)) return false;
  const pid = readFileSync(pidPath, "utf8").trim();
  if (!pid) return false;
  try {
    execSync(
      `powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
      { encoding: "utf8" }
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForPortFree(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isBridgeRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startBridge() {
  try {
    spawn("cmd.exe", ["/c", "start", "flow.bat"], {
      cwd: __dirname,
      detached: true,
      stdio: "ignore",
      shell: false,
    }).unref();
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  log("Notion-AI-Bridge workspace switcher");
  log("");

  if (!existsSync(CONFIG_PATH)) {
    log("ERROR: config.json not found. Run flow-setup.bat first.");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const cookies = parseCookies(config.browser.cookies);
  if (cookies.length === 0) {
    log("ERROR: no cookies in config.json");
    process.exit(1);
  }

  log("Fetching your workspaces from Notion ...");
  const spaces = await fetchSpaces(cookies);

  if (!spaces || spaces.length === 0) {
    log("ERROR: no workspaces found. Cookies may be invalid or expired.");
    log("Try re-running flow-setup.bat to refresh the session.");
    process.exit(1);
  }

  const currentId = config.notion.workspaceId;

  log("");
  log("Your Notion workspaces:");
  log("");
  spaces.forEach((s, i) => {
    const num = String(i + 1).padStart(2, " ");
    const name = s.name || "(no name)";
    const plan = describePlan(s);
    const tag = s.id === currentId ? "  << current" : "";
    log(`  [${num}]  ${name}${tag}`);
    log(`          id:   ${s.id}`);
    log(`          plan: ${plan}`);
    log("");
  });

  const answer = await ask("Pick workspace number (or q to quit): ");
  if (answer.toLowerCase() === "q") {
    log("Cancelled.");
    process.exit(0);
  }
  const choice = parseInt(answer, 10);
  if (isNaN(choice) || choice < 1 || choice > spaces.length) {
    log("Invalid choice.");
    process.exit(1);
  }

  const picked = spaces[choice - 1];
  log("");
  log(`Switching to: ${picked.name}`);
  log(`  id:   ${picked.id}`);
  log(`  plan: ${describePlan(picked)}`);

  if (picked.id === currentId) {
    log("Already on this workspace. Nothing to do.");
    process.exit(0);
  }

  const hasAi = PLANS_WITH_AI.has(picked.plan_type);
  if (!hasAi) {
    log("");
    log("WARNING: this workspace's plan doesn't include Notion AI.");
    log("The bridge will return 'trust-rule-denied' on calls until you switch back.");
    const confirm = await ask("Continue anyway? (y/n): ");
    if (confirm.toLowerCase() !== "y") {
      log("Cancelled.");
      process.exit(0);
    }
  }

  config.notion.workspaceId = picked.id;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  log("");
  log("config.json updated.");

  if (isBridgeRunning()) {
    log("");
    const restart = await ask("Bridge is running. Restart it now? (y/n): ");
    if (restart.toLowerCase() === "y") {
      log("Stopping bridge ...");
      killBridge();
      const freed = await waitForPortFree(8787, 10000);
      if (!freed) {
        log("Port 8787 still bound after 10s. Start bridge manually: flow.bat");
        process.exit(1);
      }
      log("Starting bridge ...");
      if (startBridge()) {
        log(
          "Bridge restart triggered. Wait ~5s, then test with: curl http://127.0.0.1:8787/health"
        );
      } else {
        log("Auto-start failed. Run flow.bat manually.");
      }
    } else {
      log("Restart later: flow-stop.bat && flow.bat");
    }
  } else {
    log("");
    log("Start the bridge with flow.bat to use the new workspace.");
  }
}

main().catch((e) => {
  console.error("FATAL:", e.stack || e.message);
  process.exit(1);
});
