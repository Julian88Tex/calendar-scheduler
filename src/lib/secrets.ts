// Secrets bootstrap (ARCHITECTURE section 18.1, SPEC GEN-09).
//
// getSecret(name) returns 32 bytes:
// 1. env: SESSION_SECRET / ENCRYPTION_KEY (any string; key = SHA-256 of the string),
// 2. else the app_secrets row,
// 3. else 32 random bytes inserted with ON CONFLICT DO NOTHING and re-read (race safe across instances).
// Cached in memory per process (and keyed by the env value, so changing env in tests takes effect).
//
// Trade-off (documented on the setup page and in Admin): a key stored in the database protects tokens against backup
// leaks only when ENCRYPTION_KEY is set in env. Changing ENCRYPTION_KEY later makes stored tokens unreadable; callers
// use decryptOrNull() and show "Action required" (reconnect) instead of crashing.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { appSecrets } from "@/db/schema";

export type SecretName = "session_secret" | "encryption_key";

const ENV_VAR: Record<SecretName, "SESSION_SECRET" | "ENCRYPTION_KEY"> = {
  session_secret: "SESSION_SECRET",
  encryption_key: "ENCRYPTION_KEY",
};

const cache = new Map<string, Promise<Buffer>>();

/** SHA-256 of an env secret string: any length in, 32 bytes out. */
export function keyFromString(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Reads an app_secrets value, creating it with `create()` when missing (INSERT ... ON CONFLICT DO NOTHING, then
 * re-read, so concurrent cold starts agree on one value).
 */
export async function getOrCreateAppSecret(key: string, create: () => string, db?: DbOrTx): Promise<string> {
  const d = db ?? (await getDb());
  const read = async () =>
    (await d.select({ value: appSecrets.value }).from(appSecrets).where(eq(appSecrets.key, key)).limit(1))[0]?.value;
  const existing = await read();
  if (existing) return existing;
  await d.insert(appSecrets).values({ key, value: create() }).onConflictDoNothing({ target: appSecrets.key });
  const value = await read();
  if (!value) throw new Error(`app secret ${key} could not be created`);
  return value;
}

/** A 32-byte secret (see the file header for the lookup order). */
export function getSecret(name: SecretName): Promise<Buffer> {
  const fromEnv = process.env[ENV_VAR[name]]?.trim();
  const cacheKey = fromEnv ? `env:${name}:${keyFromString(fromEnv).toString("hex")}` : `db:${name}`;
  let hit = cache.get(cacheKey);
  if (!hit) {
    hit = fromEnv
      ? Promise.resolve(keyFromString(fromEnv))
      : getOrCreateAppSecret(name, () => randomBytes(32).toString("base64url")).then((v) => {
          const buf = Buffer.from(v, "base64url");
          // Accept any stored string: 32 decoded bytes as is, anything else hashed to 32 bytes.
          return buf.length === 32 ? buf : keyFromString(v);
        });
    hit.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, hit);
  }
  return hit;
}

/** True when the secret comes from env (setup page and Admin checklist). */
export function secretFromEnv(name: SecretName): boolean {
  return Boolean(process.env[ENV_VAR[name]]?.trim());
}

/** Drops cached secrets (tests switch databases between files; reset routes keep app_secrets). */
export function clearSecretCache(): void {
  cache.clear();
}
