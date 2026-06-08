/**
 * puppeteer-client.js — replace Node fetch dengan real Chromium request.
 *
 * Cara kerja:
 * 1. Launch Microsoft Edge (Chromium 148, match Notion's sec-ch-ua exactly)
 * 2. Inject user's Notion cookies into the browser context
 * 3. Use page.evaluate(() => fetch(...)) untuk call Notion API dari dalam browser
 * 4. Real Chromium TLS fingerprint + HTTP/2 fingerprint + header order = match Notion web app
 *
 * Trade-off: lebih lambat dari fetch (1-2s per request karena browser roundtrip)
 * Tapi reliable untuk bypass Notion's trust rule check.
 */

import puppeteer from "puppeteer-core";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cookieJar as cfgCookieJar } from "./load-config.js";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  // macOS
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  // Linux
  "/usr/bin/microsoft-edge",
  "/usr/bin/microsoft-edge-stable",
  "/opt/microsoft/msedge/msedge",
];

let browser = null;
let page = null;
let pageUrl = "about:blank";

/**
 * Find Edge executable.
 */
function findEdgePath() {
  // Explicit override; also lets non-Windows users point at any
  // Chromium-family binary.
  const fromEnv = process.env.NOTION_BRIDGE_EDGE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const p of EDGE_PATHS) {
    // existsSync — do NOT readFileSync the whole ~150MB browser binary just
    // to test for existence.
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Convert cookies.json to puppeteer cookie format.
 * Uses `url` field to bind cookies to the exact Notion origin
 * (covers both .notion.com and app.notion.com regardless of how the cookie
 *  was originally scoped).
 */
function _shapeCookie(c) {
  return {
    name: c.name,
    value: c.value,
    url: "https://app.notion.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: c.name === "token_v2" ? "None" : "Lax",
  };
}

function loadCookies() {
  // 1) Prefer cookies supplied via config.json (browser.cookies array)
  if (Array.isArray(cfgCookieJar) && cfgCookieJar.length > 0) {
    return cfgCookieJar.map(_shapeCookie);
  }
  // 2) Fall back to a sibling cookies.json (legacy / external jars)
  const jarPath = process.env.COOKIE_JAR_PATH || "./cookies.json";
  if (existsSync(jarPath)) {
    const cookiesJson = JSON.parse(readFileSync(jarPath, "utf8"));
    const arr = Array.isArray(cookiesJson) ? cookiesJson : cookiesJson.cookies;
    if (Array.isArray(arr) && arr.length > 0) return arr.map(_shapeCookie);
  }
  throw new Error("No cookies found. Set config.json `browser.cookies` (array or \"k=v; k2=v2\" string) or create cookies.json.");
}

/**
 * Launch Edge with cookies, create persistent page.
 */
export async function initPuppeteer({ headless = true } = {}) {
  if (browser) return { browser, page };

  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error("Microsoft Edge not found. Install Edge or provide a path.");
  }

  console.log(`[puppeteer] launching Edge: ${edgePath}`);
  const userDataDir = process.env.NOTION_BRIDGE_USER_DATA_DIR ||
    `C:\\Users\\ollama\\AppData\\Local\\Temp\\notion-bridge-edge-${Date.now()}`;
  browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: headless ? "new" : false,
    userDataDir,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-extensions",
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    dumpio: false,
  });

  const ctx = browser.defaultBrowserContext();
  const cookies = loadCookies();
  await ctx.setCookie(...cookies);

  page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.3967.96"
  );

  // Navigate to app.notion.com to establish session cookies / Sentry context
  pageUrl = "https://app.notion.com/ai";
  try {
    // Use domcontentloaded — the older Puppeteer on Node 24 doesn't accept "commit".
    // domcontentloaded fires once initial HTML is parsed; we don't need to wait
    // for the full Notion SPA to render — just need the cookies to land in the jar.
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => {
      console.warn("[puppeteer] initial nav warning:", e.message);
    });
    // Give Cloudflare + Notion a moment to set/refresh cookies
    await new Promise((r) => setTimeout(r, 2000));
    const title = await page.title().catch(() => "?");
    const url = page.url();
    console.log(`[puppeteer] page loaded: "${title}" @ ${url}`);
    const cookiesInPage = await ctx.cookies();
    const hasToken = cookiesInPage.some((c) => c.name === "token_v2");
    console.log(`[puppeteer] total cookies: ${cookiesInPage.length}, has token_v2: ${hasToken}`);
  } catch (e) {
    console.warn("[puppeteer] initial nav warning:", e.message);
  }

  return { browser, page };
}

/**
 * Call Notion API from inside the browser. Returns the response body as string
 * plus the response status.
 *
 * @param {string} url
 * @param {object} headers - lower-case keys recommended
 * @param {object} body - will be JSON.stringify'd
 * @returns {Promise<{status: number, body: string, headers: object}>}
 */
export async function callNotionFromBrowser(url, headers, body) {
  if (!page) await initPuppeteer();

  const bodyStr = JSON.stringify(body);
  const fetchArgs = { url, headers, bodyStr };

  // Retry on transient "Failed to fetch" (page not ready / network blip).
  // Same-origin fetch from app.notion.com context, with browser's own cookies.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await page.evaluate(
        async ({ url, headers, bodyStr }) => {
          const res = await fetch(url, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: bodyStr,
            credentials: "include",
            mode: "cors",
          });
          const text = await res.text();
          const respHeaders = {};
          res.headers.forEach((v, k) => { respHeaders[k] = v; });
          return { status: res.status, body: text, headers: respHeaders };
        },
        fetchArgs
      );
      return result;
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      console.warn(`[puppeteer] call attempt ${attempt} failed: ${msg.slice(0, 200)}`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500));
        try { await page.goto(pageUrl || "https://app.notion.com/ai", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {}
      }
    }
  }
  throw lastErr;
}

/**
 * Cleanup: close browser.
 */
export async function closePuppeteer() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// CLI test entrypoint
if (import.meta.url === `file:///${resolve(process.argv[1]).replace(/\\/g, "/")}`) {
  (async () => {
    const r = await callNotionFromBrowser(
      "https://app.notion.com/api/v3/authValidate",
      {},
      {}
    );
    console.log("authValidate:", r.status, r.body.slice(0, 200));
    await closePuppeteer();
  })();
}
