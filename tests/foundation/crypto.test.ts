// Crypto and secrets (ARCHITECTURE 18.1 and 18.2, SPEC GEN-08, GEN-09).
import { createHash, createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSecrets } from "@/db/schema";
import {
  decrypt,
  decryptOrNull,
  decryptWithKey,
  encrypt,
  encryptWithKey,
  hashCode,
  hashIp,
  hashPassword,
  hashToken,
  hmacSha256Hex,
  isEncrypted,
  randomCode,
  randomToken,
  timingSafeEqualStr,
  verifyCode,
  verifyPassword,
} from "@/lib/crypto";
import { clearSecretCache, getOrCreateAppSecret, getSecret, keyFromString, secretFromEnv } from "@/lib/secrets";
import { useTestDb } from "../helpers/db";

const env = process.env as Record<string, string | undefined>;
const t = useTestDb();

beforeEach(() => {
  clearSecretCache();
  delete env.SESSION_SECRET;
  delete env.ENCRYPTION_KEY;
});
afterEach(() => {
  delete env.SESSION_SECRET;
  delete env.ENCRYPTION_KEY;
  clearSecretCache();
});

describe("secrets", () => {
  it("generates a 32-byte secret once, stores it in app_secrets and reuses it", async () => {
    const a = await getSecret("encryption_key");
    expect(a).toHaveLength(32);
    clearSecretCache(); // a restart re-reads the same row (GEN-09)
    const b = await getSecret("encryption_key");
    expect(b.equals(a)).toBe(true);
    const rows = await t.db.select().from(appSecrets).where(eq(appSecrets.key, "encryption_key"));
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]!.value, "base64url").equals(a)).toBe(true);
  });

  it("session and encryption secrets differ", async () => {
    const s = await getSecret("session_secret");
    const e = await getSecret("encryption_key");
    expect(s.equals(e)).toBe(false);
  });

  it("prefers env and derives the key with SHA-256 of any string", async () => {
    env.ENCRYPTION_KEY = "my env secret";
    expect(secretFromEnv("encryption_key")).toBe(true);
    const k = await getSecret("encryption_key");
    expect(k.equals(createHash("sha256").update("my env secret").digest())).toBe(true);
    expect(k.equals(keyFromString("my env secret"))).toBe(true);
  });

  it("concurrent first reads agree on one stored value (insert on conflict do nothing, re-read)", async () => {
    const values = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateAppSecret("race_test", () => randomBytes(8).toString("hex"), t.db)),
    );
    expect(new Set(values).size).toBe(1);
  });
});

describe("encryption at rest", () => {
  it("round trips with the v1.iv.ct.tag format and a fresh IV every time", async () => {
    const a = await encrypt("refresh-token-123");
    const b = await encrypt("refresh-token-123");
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(isEncrypted(a)).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(a).not.toContain("refresh-token-123");
    expect(await decrypt(a)).toBe("refresh-token-123");
    expect(await decrypt(await encrypt(""))).toBe("");
    expect(await decrypt(await encrypt("ünïcödé ✓"))).toBe("ünïcödé ✓");
  });

  it("detects tampering and a changed key; decryptOrNull never throws", async () => {
    const key = randomBytes(32);
    const blob = encryptWithKey("secret", key);
    const [v, iv, ct, tag] = blob.split(".");
    const flipped = `${v}.${iv}.${Buffer.from(Buffer.from(ct!, "base64url").map((x) => x ^ 1)).toString("base64url")}.${tag}`;
    expect(() => decryptWithKey(flipped, key)).toThrow();
    expect(() => decryptWithKey(blob, randomBytes(32))).toThrow();
    expect(() => decryptWithKey("v2.a.b.c", key)).toThrow();
    expect(() => encryptWithKey("x", randomBytes(16))).toThrow();

    const stored = await encrypt("token");
    env.ENCRYPTION_KEY = "rotated";
    clearSecretCache();
    await expect(decrypt(stored)).rejects.toThrow();
    expect(await decryptOrNull(stored)).toBeNull();
    expect(await decryptOrNull(null)).toBeNull();
    expect(await decryptOrNull("garbage")).toBeNull();
  });
});

describe("tokens and comparisons", () => {
  it("hashToken is SHA-256 hex; randomToken has at least 128 bits", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    const tok = randomToken();
    expect(Buffer.from(tok, "base64url")).toHaveLength(32);
    expect(new Set(Array.from({ length: 50 }, () => randomToken())).size).toBe(50);
    expect(() => randomToken(8)).toThrow();
  });

  it("randomCode draws from the alphabet", () => {
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^\d{6}$/);
    expect(randomCode(10, "ab")).toMatch(/^[ab]{10}$/);
  });

  it("hmacSha256Hex and timingSafeEqualStr", () => {
    expect(hmacSha256Hex("k", "d")).toBe(createHmac("sha256", "k").update("d").digest("hex"));
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});

describe("hashCode (verification codes, GEN-08)", () => {
  it("is an HMAC with the session secret bound to purpose and context, never a plain SHA-256", async () => {
    const h = await hashCode("booking", "res-1", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(createHash("sha256").update("123456").digest("hex"));
    expect(h).not.toBe(createHash("sha256").update("booking:res-1:123456").digest("hex"));
    const secret = await getSecret("session_secret");
    expect(h).toBe(createHmac("sha256", secret).update("booking:res-1:123456").digest("hex"));
    expect(await hashCode("booking", "res-1", "123456")).toBe(h); // deterministic
    expect(await hashCode("poll_vote", "res-1", "123456")).not.toBe(h); // purpose bound
    expect(await hashCode("booking", "res-2", "123456")).not.toBe(h); // context bound
    expect(await hashCode("booking", "res-1", "123457")).not.toBe(h);
  });

  it("verifyCode accepts the right code (trimmed) and rejects others", async () => {
    const stored = await hashCode("poll_vote", "poll-9", "654321");
    expect(await verifyCode("poll_vote", "poll-9", " 654321 ", stored)).toBe(true);
    expect(await verifyCode("poll_vote", "poll-9", "654320", stored)).toBe(false);
    expect(await verifyCode("poll_vote", "poll-8", "654321", stored)).toBe(false);
  });

  it("changes when the session secret changes", async () => {
    const a = await hashCode("booking", null, "111111");
    env.SESSION_SECRET = "another secret";
    clearSecretCache();
    expect(await hashCode("booking", null, "111111")).not.toBe(a);
  });

  it("hashIp hides the IP and is stable", async () => {
    const a = await hashIp("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("203");
    expect(await hashIp("203.0.113.7")).toBe(a);
    expect(await hashIp("203.0.113.8")).not.toBe(a);
  });
});

describe("passwords (scrypt)", () => {
  it("hashes with scrypt N=16384 r=8 p=1 and a 64-byte key, and verifies", async () => {
    const stored = await hashPassword("correct horse 1");
    const parts = stored.split("$");
    expect(parts.slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
    expect(Buffer.from(parts[5]!, "base64url")).toHaveLength(64);
    expect(await verifyPassword("correct horse 1", stored)).toBe(true);
    expect(await verifyPassword("correct horse 2", stored)).toBe(false);
    expect(await hashPassword("correct horse 1")).not.toBe(stored); // salted
  });

  it("normalizes with NFKC and rejects malformed hashes", async () => {
    const composed = "caf\u00e9 pass1";
    const decomposed = "cafe\u0301 pass1";
    const stored = await hashPassword(composed);
    expect(await verifyPassword(decomposed, stored)).toBe(true);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(await verifyPassword("x", "scrypt$abc$8$1$c2FsdA$aGFzaA")).toBe(false);
  });
});
