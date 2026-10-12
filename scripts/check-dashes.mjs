#!/usr/bin/env node
// GEN-11: no em dashes (U+2014) or en dashes (U+2013) anywhere: code, comments, copy and docs.
//   npm run check:dashes            scans src, docs, public, e2e, tests, scripts, .github and root files
//   node scripts/check-dashes.mjs <paths...>   scans only the given files or directories
// Exits 1 and prints file:line:column for every occurrence.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const DEFAULT_DIRS = ["src", "docs", "public", "e2e", "tests", "scripts", ".github", "drizzle"];
const ROOT_FILES = [
  "README.md",
  "package.json",
  "next.config.ts",
  "drizzle.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "vercel.json",
  ".env.example",
  ".gitignore",
  "tsconfig.json",
];
const SKIP_DIRS = new Set(["node_modules", ".git", ".data", ".cache", "test-results", "playwright-report"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".gz", ".mp4",
  ".mov", ".wasm", ".tar", ".tgz",
]);
// Built from code points so this file itself never contains the characters it forbids.
const FORBIDDEN = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`, "g");
const NAMES = { 0x2013: "en dash (U+2013)", 0x2014: "em dash (U+2014)" };

function* walk(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isFile()) {
    yield target;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".next"))) continue;
    yield* walk(path.join(target, entry.name));
  }
}

const args = process.argv.slice(2);
const targets = args.length ? args : [...DEFAULT_DIRS, ...ROOT_FILES];
let count = 0;
let files = 0;
for (const target of targets) {
  for (const file of walk(path.resolve(root, target))) {
    if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    files++;
    if (!FORBIDDEN.test(text)) continue;
    FORBIDDEN.lastIndex = 0;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(FORBIDDEN)) {
        count++;
        const code = m[0].charCodeAt(0);
        console.log(`${path.relative(root, file)}:${i + 1}:${(m.index ?? 0) + 1}: ${NAMES[code]}`);
      }
    });
  }
}
if (count > 0) {
  console.error(`check-dashes: ${count} forbidden dash(es) found (GEN-11). Use a hyphen, comma, colon or parentheses.`);
  process.exit(1);
}
console.log(`check-dashes: OK (${files} files scanned)`);
