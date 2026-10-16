// Setup page decision (SPEC GEN-09, ADM-09, ARCHITECTURE sections 4 and 5.1): on Vercel without a database URL every
// page request gets the setup page with status 503, API requests get 503 setup_required, /api/health reports
// setupRequired and /setup itself renders without a database.
// - The proxy decision is checked directly (pure function, same code the running proxy uses).
// - /setup is rendered by the suite's server (it never touches the database).
// - With E2E_SERVER=start (CI), a second `next start` of the same build runs with VERCEL=1 and no database URL and the
//   real responses are checked end to end.
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { isSetupMode, proxyDecision } from "../../src/lib/net/proxy-decision";
import { expect, test } from "../fixtures";

const SETUP_ENV = { VERCEL: "1" };

test.describe("setup page decision", () => {
  test("the proxy serves the setup page on Vercel without a database", () => {
    const d = (pathname: string, env: Record<string, string | undefined> = SETUP_ENV, hasSession = false) =>
      proxyDecision({ pathname, hasSession, env }).kind;
    expect(isSetupMode(SETUP_ENV)).toBe(true);
    for (const path of ["/", "/julianjoseph", "/julianjoseph/30min", "/login", "/app/scheduling", "/cancellations/x"]) {
      expect(d(path), path).toBe("setup_page");
    }
    expect(d("/app/scheduling", SETUP_ENV, true)).toBe("setup_page");
    expect(d("/setup")).toBe("next");
    expect(d("/api/health")).toBe("next");
    expect(d("/api/v1/users/me")).toBe("setup_api");
    expect(d("/api/cron")).toBe("setup_api");
    expect(d("/_next/static/chunks/main.js")).toBe("next");
    // A database URL (or not being on Vercel) turns setup mode off.
    expect(isSetupMode({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.example.com/app" })).toBe(false);
    expect(isSetupMode({ VERCEL: "1", POSTGRES_URL: "postgres://u:p@db.example.com/app" })).toBe(false);
    expect(isSetupMode({})).toBe(false);
    expect(d("/", {})).toBe("next");
    expect(d("/app/scheduling", {})).toBe("login_redirect");
  });

  test("/setup renders without a database session and is not indexed", async ({ page }) => {
    const res = await page.goto("/setup");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: /^Finish setting up / })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
  });
});

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

async function waitForHealth(base: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`setup-mode server exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 503 || res.status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("setup-mode server did not start in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}

test.describe("setup mode end to end (next start)", () => {
  test.skip(process.env.E2E_SERVER !== "start", "needs a production build (E2E_SERVER=start)");

  let child: ChildProcess | null = null;
  let base = "";

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const port = await freePort();
    base = `http://localhost:${port}`;
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v !== "string") continue;
      if (/^(DATABASE_URL|POSTGRES_URL|DATABASE_URL_UNPOOLED|POSTGRES_URL_NON_POOLING|E2E_TEST_MODE|E2E_SECRET|VERCEL_ENV)$/.test(k)) continue;
      env[k] = v;
    }
    Object.assign(env, {
      NODE_ENV: "production",
      VERCEL: "1",
      PORT: String(port),
      APP_URL: base,
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-e2e",
      PGLITE_DIR: ".data/pglite-e2e-setup-mode-unused",
      NEXT_TELEMETRY_DISABLED: "1",
    });
    // Its own process group, so afterAll can stop the whole tree (npx, sh and next-server).
    const server = spawn("npx", ["next", "start", "-p", String(port)], { env, stdio: "ignore", detached: true });
    child = server;
    await waitForHealth(base, server);
  });

  test.afterAll(async () => {
    const pid = child?.pid;
    if (!pid) return;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-pid, signal);
      } catch {
        // already gone
      }
    };
    killGroup("SIGTERM");
    for (let i = 0; i < 20 && groupAlive(pid); i++) await new Promise((r) => setTimeout(r, 250));
    if (groupAlive(pid)) killGroup("SIGKILL");
  });

  test("pages answer 503 with the setup page, APIs 503 setup_required, health reports setupRequired", async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ ok: false, setupRequired: true });

    for (const path of ["/", "/julianjoseph", "/app/scheduling", "/login"]) {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(503);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(await res.text(), path).toContain("Finish setting up ");
    }

    const api = await fetch(`${base}/api/v1/users/me`);
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ error: "setup_required" });

    const setup = await fetch(`${base}/setup`);
    expect(setup.status).toBe(200);
    expect(await setup.text()).toContain("Finish setting up ");
  });
});
