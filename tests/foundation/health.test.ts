// GET /api/health (SPEC ADM-09, GEN-09): { ok, db, setupRequired, version, time } without secrets; 200 when the
// database answers, 503 with setupRequired on Vercel without a database URL.
import { afterEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { useTestDb } from "../helpers/db";

const env = process.env as Record<string, string | undefined>;

describe("/api/health", () => {
  useTestDb();
  afterEach(() => {
    delete env.VERCEL;
    delete env.VERCEL_GIT_COMMIT_SHA;
  });

  it("reports the local database (db: pglite) with version and time", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, db: process.env.TEST_DATABASE_URL ? "postgres" : "pglite", setupRequired: false, version: "0.1.0" });
    expect(Date.parse(String(body.time))).not.toBeNaN();
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|password|secret/i);
  });

  it("answers 503 with setupRequired and db missing on Vercel without a database URL", async () => {
    env.VERCEL = "1";
    env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const saved = { DATABASE_URL: env.DATABASE_URL, POSTGRES_URL: env.POSTGRES_URL };
    delete env.DATABASE_URL;
    delete env.POSTGRES_URL;
    try {
      const res = await healthGET();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, db: "missing", setupRequired: true, version: "0.1.0+abcdef1" });
    } finally {
      Object.assign(env, saved);
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete env[k];
    }
  });
});
