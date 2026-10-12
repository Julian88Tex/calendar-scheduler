// Build-time migrations: `npm run build` = `node scripts/migrate.ts && next build` (tech-reference 3.4, ARCHITECTURE 5.1).
//
// Runs under PLAIN Node 22 type stripping in the Vercel build: relative imports with explicit .ts extensions, only
// src/db/migrate.ts (drizzle packages and node:* built-ins), no "@/" aliases, no "server-only".
// Exits 0 without connecting when no database URL exists (local PGlite builds, Vercel before Neon is attached) or when
// shouldMigrate() is false (Vercel previews without MIGRATE_ON_PREVIEW=1).
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrateGuarded, shouldMigrate } from "../src/db/migrate.ts";

const pooled = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || pooled;

if (!url) {
  console.log("[migrate] no database URL, skipping (PGlite migrates on first use; Vercel shows the setup page)");
  process.exit(0);
}
if (!shouldMigrate()) {
  console.log(
    `[migrate] skipping on VERCEL_ENV=${process.env.VERCEL_ENV ?? ""} (set MIGRATE_ON_PREVIEW=1 when previews get their own database)`,
  );
  process.exit(0);
}

// postgres.js forwards unknown URL params as GUCs; Neon URLs may carry channel_binding (see src/db/index.ts).
const u = new URL(url);
for (const k of ["channel_binding", "gssencmode", "sslcompression"]) u.searchParams.delete(k);

const client = postgres(u.toString(), { max: 1, prepare: false, onnotice: () => {} });
try {
  const applied = await migrateGuarded(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  console.log(`[migrate] applied ${applied} migration(s)`);
} catch (e) {
  console.error("[migrate] failed:", e);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
