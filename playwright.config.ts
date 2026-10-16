// Playwright 1.64 (tech-reference 12.2, ARCHITECTURE section 24.2). Never run `playwright install`: the sandbox ships
// Chromium 141 at /opt/pw-browsers and executablePath points at it.
//
// Parameterized so modules can run their e2e suites in parallel without sharing state:
//   E2E_PORT       server port (default 3313)
//   E2E_SERVER     "dev" (default, next dev) or "start" (next start; requires a prior next build into NEXT_DIST_DIR)
//   PGLITE_DIR     database dir for the server (default .data/pglite-e2e); never shared between processes
//   NEXT_DIST_DIR  build output dir (default .next-e2e)
//   E2E_SECRET     generated per run unless provided; sent as x-e2e-secret by the fixtures (e2e/fixtures/index.ts)
// Example: E2E_PORT=3400 PGLITE_DIR=.data/pglite-e2e-foundation NEXT_DIST_DIR=.next-e2e-foundation \
//          scripts/heavy.sh server npx playwright test e2e/foundation
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const LOCAL_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(LOCAL_CHROME) ? LOCAL_CHROME : undefined);

const PORT = Number(process.env.E2E_PORT ?? 3313);
const SERVER = process.env.E2E_SERVER === "start" ? "start" : "dev";
const PGLITE_DIR = process.env.PGLITE_DIR ?? ".data/pglite-e2e";
const NEXT_DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-e2e";
const BASE_URL = `http://localhost:${PORT}`;

// One secret per run. Setting it on process.env before workers start makes every worker (which re-evaluates this
// config) and the web server see the same value.
process.env.E2E_SECRET ??= randomBytes(24).toString("hex");
process.env.E2E_BASE_URL = BASE_URL;
const E2E_SECRET = process.env.E2E_SECRET;

// The server always runs on its own PGlite dir: never inherit a real database or Vercel settings from the shell.
const ISOLATE = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "VERCEL", "VERCEL_ENV"];
const serverEnv = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string" && !ISOLATE.includes(e[0])),
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: `test-results/${NEXT_DIST_DIR.replace(/[^a-zA-Z0-9-]+/g, "")}`,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    timezoneId: "America/New_York",
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: SERVER === "start" ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // The server lives only for this run, so an idle dev server never recompiles on other agents' writes.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...serverEnv,
      PORT: String(PORT),
      APP_URL: BASE_URL,
      PGLITE_DIR,
      NEXT_DIST_DIR,
      E2E_TEST_MODE: "1",
      E2E_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
