// Webhook subscriptions, personal access tokens and calendar feeds.
import type { DbOrTx } from "@/db";
import { apiTokens, calendarFeeds, webhookSubscriptions } from "@/db/schema";
import { one, randomToken, sha256Hex } from "./_util";
import type { TestUser } from "./users";

export async function createWebhookSubscription(
  db: DbOrTx,
  opts: {
    owner: TestUser;
    scope?: "organization" | "user" | "group";
    groupId?: string | null;
    callbackUrl?: string;
    events?: string[];
    state?: "active" | "disabled";
  },
) {
  const scope = opts.scope ?? "user";
  return one(
    await db
      .insert(webhookSubscriptions)
      .values({
        organizationId: opts.owner.organizationId,
        scope,
        userId: scope === "user" ? opts.owner.id : null,
        groupId: scope === "group" ? (opts.groupId ?? null) : null,
        callbackUrl: opts.callbackUrl ?? "https://hooks.example.com/kairos",
        events: opts.events ?? ["invitee.created", "invitee.canceled"],
        signingKeyEnc: "fake.signing-key",
        state: opts.state ?? "active",
        creatorUserId: opts.owner.id,
      })
      .returning(),
    "webhook subscription",
  );
}

/** A personal access token; returns the plaintext token (shown once in the UI) and the stored row. */
export async function createApiToken(db: DbOrTx, opts: { userId: string; name?: string; scopes?: string[] }) {
  const secret = randomToken(24);
  const token = `kai_pat_${secret}`;
  const row = one(
    await db
      .insert(apiTokens)
      .values({
        userId: opts.userId,
        name: opts.name ?? "Test token",
        tokenHash: sha256Hex(token),
        prefix: token.slice(0, 12),
        scopes: opts.scopes ?? ["default"],
      })
      .returning(),
    "api token",
  );
  return { token, row };
}

export async function createCalendarFeed(db: DbOrTx, opts: { userId: string }) {
  const token = randomToken();
  const row = one(
    await db
      .insert(calendarFeeds)
      .values({ userId: opts.userId, tokenHash: sha256Hex(token), tokenEnc: `fake.${token}` })
      .returning(),
    "calendar feed",
  );
  return { token, row };
}
