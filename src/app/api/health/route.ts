// GET /api/health (foundation, SPEC ADM-09 and GEN-09): liveness plus database and setup state, never secrets.
//   { ok, db: "pglite" | "postgres" | "missing", setupRequired, version, time, schemaBehind? }
// 200 when the database answers; 503 when it is unreachable or setup is required (Vercel without a database URL).
// The first call also opens the database (and migrates it), which the Playwright web server waits for.
import { sql } from "drizzle-orm";
import { dbKind, dbUrl, getDb, isSchemaBehind, isSetupRequiredError, setupRequired } from "@/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type HealthBody = {
  ok: boolean;
  db: "pglite" | "postgres" | "missing";
  setupRequired: boolean;
  version: string;
  time: string;
  /** Bundled migrations are ahead of the database (Vercel previews without MIGRATE_ON_PREVIEW). */
  schemaBehind?: boolean;
  error?: "database_unavailable";
};

/** App version, plus the short commit on Vercel ("0.1.0+abc1234"). */
function appVersion(env: Record<string, string | undefined> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return sha ? `${pkg.version}+${sha}` : pkg.version;
}

function currentDbKind(): HealthBody["db"] {
  const kind = dbKind();
  if (kind === "postgres" || kind === "pglite") return kind;
  if (kind === "test") return dbUrl() || process.env.TEST_DATABASE_URL ? "postgres" : "pglite";
  return dbUrl() ? "postgres" : "pglite";
}

function body(fields: Omit<HealthBody, "version" | "time">): HealthBody {
  return { ...fields, version: appVersion(), time: new Date().toISOString() };
}

export async function GET() {
  if (setupRequired()) {
    return Response.json(body({ ok: false, db: "missing", setupRequired: true }), { status: 503, headers: noStore });
  }
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json(body({ ok: true, db: currentDbKind(), setupRequired: false, schemaBehind: isSchemaBehind() }), {
      headers: noStore,
    });
  } catch (e) {
    if (isSetupRequiredError(e)) {
      return Response.json(body({ ok: false, db: "missing", setupRequired: true }), { status: 503, headers: noStore });
    }
    console.error(JSON.stringify({ level: "error", event: "health.database_unavailable", message: String(e) }));
    return Response.json(
      body({ ok: false, db: dbUrl() ? "postgres" : "pglite", setupRequired: false, error: "database_unavailable" }),
      { status: 503, headers: noStore },
    );
  }
}
