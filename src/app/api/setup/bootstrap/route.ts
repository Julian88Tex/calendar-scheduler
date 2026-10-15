// POST /api/setup/bootstrap (docs/DEPLOY.md, step "Bootstrap the owner"): creates the owner account of a fresh
// instance and applies the owner's Calendly setup (src/lib/setup/bootstrap.ts). Idempotent: running it again reports
// what is already there and never overwrites later edits.
//
//   curl -X POST "$APP_URL/api/setup/bootstrap" -H "Authorization: Bearer $SETUP_TOKEN" \
//        -H "Content-Type: application/json" -d '{"email":"owner@example.com"}'
//
// - Authorization: "Bearer {SETUP_TOKEN}" or "Bearer {CRON_SECRET}" (constant-time comparison; each counts only when at
//   least 24 characters long). With neither usable the endpoint is disabled (501 not_configured). Wrong or missing
//   header: 401.
// - Fresh instance (no live account yet): rate limited per IP (10 per 15 minutes) and overall (30 per hour), counted
//   before the token is checked, since the right token claims the instance.
// - Instance with an account (setup done): no request can claim it any more, so refusals cost one read and write
//   nothing (no rate limit buckets, no transaction): a wrong token answers 401 without being counted (like /api/cron),
//   and with the right token another email than OWNER_EMAIL answers 403 and an instance with another account 409 before
//   any limit is counted. Only the owner's own rerun (200) goes on, rate limited as above.
// - Body { email, name?, avatarUrl? }; email must equal OWNER_EMAIL when that is set (403).
// - 201 when the account was created, 200 when it existed; 409 when another account already exists (checked again
//   inside the bootstrap transaction, under the signup lock).
// No cookies or sessions are involved, so there is no CSRF surface; the response is never cached.
import { hashIp } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { getClientIp, json, readJsonBody, route } from "@/lib/http";
import { log } from "@/lib/logger";
import { assertRateLimit } from "@/lib/rate-limit";
import { hasLiveAccount } from "@/lib/setup/accounts";
import { bootstrapOwner, OTHER_ACCOUNT_MESSAGE } from "@/lib/setup/bootstrap";
import { assertOwnerEmailAllowed, bearerMatches, BOOTSTRAP_DISABLED_MESSAGE, bootstrapSecrets } from "@/lib/setup/config";
import { BootstrapOwnerInputSchema } from "@/lib/setup/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BOOTSTRAP_IP_LIMIT = { limit: 10, windowSeconds: 15 * 60 } as const;
const BOOTSTRAP_GLOBAL_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

const UNAUTHORIZED_MESSAGE = "Send Authorization: Bearer <SETUP_TOKEN or CRON_SECRET>.";

async function assertBootstrapRateLimits(ipHash: string): Promise<void> {
  await assertRateLimit(`setup:bootstrap:ip:${ipHash}`, BOOTSTRAP_IP_LIMIT.limit, BOOTSTRAP_IP_LIMIT.windowSeconds);
  await assertRateLimit("setup:bootstrap:all", BOOTSTRAP_GLOBAL_LIMIT.limit, BOOTSTRAP_GLOBAL_LIMIT.windowSeconds);
}

export const POST = route(async (request: Request) => {
  const secrets = bootstrapSecrets();
  if (!secrets.length) throw new AppError("not_configured", BOOTSTRAP_DISABLED_MESSAGE);

  // Setup done (see the file header): refusals below cost this one read and write nothing.
  const setUp = await hasLiveAccount();
  const ipHash = await hashIp(getClientIp(request));
  if (!setUp) await assertBootstrapRateLimits(ipHash);

  if (!bearerMatches(request.headers.get("authorization"), secrets)) {
    log.warn("setup.bootstrap_unauthorized", { ipHash });
    return json({ error: "unauthorized", message: UNAUTHORIZED_MESSAGE }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  const input = await readJsonBody(request, BootstrapOwnerInputSchema);
  if (setUp) {
    assertOwnerEmailAllowed(input.email);
    if (await hasLiveAccount({ exceptEmail: input.email })) throw new AppError("conflict", OTHER_ACCOUNT_MESSAGE);
    await assertBootstrapRateLimits(ipHash);
  }
  const result = await bootstrapOwner(input);
  return json({ ok: true, ...result }, { status: result.account === "created" ? 201 : 200 });
});
