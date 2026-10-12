// TOTP and recovery codes, pure part (SPEC AU-09, RFC 6238 appendix B vectors for SHA-1).
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  looksLikeRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
  normalizeTotpCode,
  RECOVERY_CODE_COUNT,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from "@/lib/auth/totp";

// RFC 6238 test secret "12345678901234567890" (ASCII) in base32.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 6238 vectors (SHA-1, 30 second steps, last 6 digits)", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  it.each(vectors)("T=%i gives %s", (seconds, code) => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
    expect(verifyTotp(RFC_SECRET, code, { atMs: seconds * 1000 })).toBe(true);
  });
});

describe("verification window", () => {
  const at = 1_800_000_000_000;
  const secret = generateTotpSecret();
  const step = totpStep(at);

  it("accepts one step of drift either way and nothing beyond", () => {
    expect(matchTotpStep(secret, totpCode(secret, step), { atMs: at })).toBe(step);
    expect(matchTotpStep(secret, totpCode(secret, step - 1), { atMs: at })).toBe(step - 1);
    expect(matchTotpStep(secret, totpCode(secret, step + 1), { atMs: at })).toBe(step + 1);
    expect(matchTotpStep(secret, totpCode(secret, step - 2), { atMs: at })).toBeNull();
    expect(matchTotpStep(secret, totpCode(secret, step + 2), { atMs: at })).toBeNull();
  });

  it("normalizes spaces and hyphens and rejects anything that is not 6 digits", () => {
    const code = totpCode(secret, step);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { atMs: at })).toBe(true);
    expect(verifyTotp(secret, `${code.slice(0, 3)}-${code.slice(3)}`, { atMs: at })).toBe(true);
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("12a456")).toBeNull();
    expect(verifyTotp(secret, "", { atMs: at })).toBe(false);
    expect(matchTotpStep("not base32 !!", "123456", { atMs: at })).toBeNull();
  });

  it("generates 160-bit secrets that round-trip through base32", () => {
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = totpUri({ secretBase32: secret, accountName: "ada@example.com", issuer: "Kairos" });
    expect(uri.startsWith("otpauth://totp/Kairos%3Aada%40example.com?")).toBe(true);
    const q = new URL(uri).searchParams;
    expect(q.get("secret")).toBe(secret);
    expect(q.get("issuer")).toBe("Kairos");
    expect(q.get("algorithm")).toBe("SHA1");
    expect(q.get("digits")).toBe("6");
    expect(q.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("generates 10 distinct xxxxx-xxxxx codes without look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      expect(looksLikeRecoveryCode(c)).toBe(true);
    }
  });

  it("normalizes case, spaces and hyphens", () => {
    expect(normalizeRecoveryCode(" AbCdE-fGhJk ")).toBe("abcdefghjk");
    expect(looksLikeRecoveryCode("abcde fghjk")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});
