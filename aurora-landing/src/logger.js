/**
 * Simple logger with timestamps and levels.
 * Writes to stderr for errors, stdout for info.
 */

const ts = () => new Date().toISOString();

export function log(...args) {
  console.log(`[${ts()}] [info]`, ...args);
}

export function err(...args) {
  console.error(`[${ts()}] [err ]`, ...args);
}

export function debug(...args) {
  if (process.env.DEBUG || process.env.NODE_ENV === "development") {
    console.log(`[${ts()}] [dbg ]`, ...args);
  }
}
