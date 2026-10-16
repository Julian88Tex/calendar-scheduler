// Account resolution for Google and Microsoft sign-ins (SPEC AU-02, AU-03, AU-10, AU-11, AU-13, TM-03). Pure services
// over the database (no cookies, no redirects) used by src/lib/auth/oauth/intents.ts and tested directly.
//
// resolveOAuthLogin (intents login and signup), in this order:
//   1. an oauth_accounts row for (provider, provider account id): log in (the stored email follows the provider);
//   2. else a live user with the same verified email: link the provider and log in; an account without a picture
//      (no uploaded avatar, no provider avatar) adopts the provider's profile picture, so an account created without
//      one (the owner bootstrap, src/lib/setup/bootstrap.ts, or an email signup) shows the Google photo;
//   3. else create the account under the signup policy (advisory lock, first user is instance admin), with the name,
//      avatar and verified email from the provider and the AU-13 default location (Google Meet for Google).
// Unverified provider emails can only log in to an already linked account (step 1).
//
// Pre-account hijacking: an account whose email was never verified may have been registered by someone else (an
// email and password signup needs no proof of the address). When a provider proves the address and is linked to such
// an account (step 2, or an invitation accepted into it), everything set before that proof is dropped in the same
// transaction: the password, two-factor authentication and its recovery codes, every session and every outstanding
// emailed token (an email change started by the squatter would otherwise move the account to their address), and
// every way back in that a new password would not close: the other sign-in methods (link_login_method needs only a
// session, so the squatter could have linked their own Google account; only the provider proving the address stays),
// calendar connections (the owner's bookings would be written to the squatter's calendar), API tokens, calendar feeds,
// webhooks created by or for the account, and the pending invitations it sent. Removals are audited where the catalog
// has an action (login_method.disconnected, calendar.disconnected). Removing rather than refusing the link keeps the
// address claimable by its owner; refusing would leave a squatted ADMIN_EMAILS address (which may always sign up with
// a password, src/lib/auth/policy.ts, and is instance admin once verified, src/lib/authz.ts) out of the owner's reach.
// The owner logs in with the provider and can set a password again with "Forgot password?".
//
// linkOAuthLoginMethod (link_login_method): connects the provider to the signed-in user; refuses an account that is
// already linked to someone else.
//
// acceptInvitationWithOAuth (accept_invitation): requires a verified provider email equal to the invitation email,
// then in one transaction finds or creates the account (inside the inviting organization with the invited role,
// regardless of the signup policy) and accepts the invitation through teams.acceptInvitationInTx.
import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import {
  apiTokens,
  authTokens,
  calendarConnections,
  calendarFeeds,
  oauthAccounts,
  organizationInvitations,
  twoFactorRecoveryCodes,
  users,
  webhookSubscriptions,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { isAppError } from "@/lib/errors";
import { acceptInvitationInTx, getPendingInvitation, type PendingInvitation } from "@/lib/teams";
import { now } from "@/lib/time/now";
import { isValidTimeZone, normalizeEmail } from "@/lib/validation";
import type { OAuthErrorCode } from "../oauth/errors";
import type { OAuthProfile, OAuthProviderId } from "../oauth/types";
import { revokeAllSessions, type UserRow } from "../session";
import { createAccountUnderPolicy, findUserByEmail } from "../signup";
import { auditAuth, primaryOrganizationId } from "./audit";

/** A resolution failure the callback turns into ?error={code}. */
export class OAuthFlowError extends Error {
  code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OAuthFlowError";
    this.code = code;
  }
}

export type OAuthResolution = {
  user: UserRow;
  oauthAccountId: string;
  /** The account was created by this sign-in (it lands on POST_SIGNUP_PATH). */
  created: boolean;
  /** The provider was connected to an existing account by this sign-in. */
  linked: boolean;
  /**
   * The existing account's email was unverified, so its password, 2FA, sessions, other sign-in methods and the access
   * it had handed out were dropped when the provider proved the address (pre-account hijacking, see the file header).
   */
  securedUnverifiedAccount?: boolean;
};

type LinkedAccount = { oauthAccountId: string; userId: string; userDeleted: boolean };

async function findLinkedAccount(db: DbOrTx, provider: OAuthProviderId, providerAccountId: string): Promise<LinkedAccount | null> {
  const [row] = await db
    .select({ oauthAccountId: oauthAccounts.id, userId: oauthAccounts.userId, deletedAt: users.deletedAt })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerAccountId, providerAccountId)))
    .limit(1);
  return row ? { oauthAccountId: row.oauthAccountId, userId: row.userId, userDeleted: row.deletedAt !== null } : null;
}

async function loadUser(db: DbOrTx, userId: string): Promise<UserRow> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new OAuthFlowError("failed", "account vanished");
  return user;
}

/** Updates the stored provider email and login time of a linked account. */
async function touchLinkedAccount(db: DbOrTx, oauthAccountId: string, profile: OAuthProfile): Promise<void> {
  await db
    .update(oauthAccounts)
    .set({ email: profile.email, emailNormalized: normalizeEmail(profile.email), lastLoginAt: now() })
    .where(eq(oauthAccounts.id, oauthAccountId));
}

async function insertOAuthAccount(db: DbOrTx, userId: string, provider: OAuthProviderId, profile: OAuthProfile): Promise<string> {
  const [row] = await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      emailNormalized: normalizeEmail(profile.email),
      lastLoginAt: now(),
    })
    .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] })
    .returning({ id: oauthAccounts.id });
  if (row) return row.id;
  // A concurrent callback for the same provider account won the insert: use its row when it is ours.
  const existing = await findLinkedAccount(db, provider, profile.providerAccountId);
  if (!existing || existing.userId !== userId) throw new OAuthFlowError("account_linked_elsewhere");
  return existing.oauthAccountId;
}

/** Removes a link that points at a deleted account, so the provider account can sign up again. */
async function dropStaleLink(db: DbOrTx, link: LinkedAccount): Promise<void> {
  await db.delete(oauthAccounts).where(eq(oauthAccounts.id, link.oauthAccountId));
}

/**
 * AU-13 default location of the first event type: Google Meet for Google signups. Microsoft Teams is outside the
 * reduced scope (docs/SCOPE.md: Google Meet is the only conferencing), so Microsoft signups start without a location.
 */
export function defaultLocationFor(provider: OAuthProviderId, profile: OAuthProfile): "google_conference" | "microsoft_teams_conference" | null {
  void profile;
  return provider === "google" ? "google_conference" : null;
}

function signupFields(provider: OAuthProviderId, profile: OAuthProfile, timezone: string | null | undefined) {
  return {
    email: profile.email,
    name: profile.name?.trim() || profile.email.split("@")[0] || profile.email,
    avatarUrl: profile.avatarUrl,
    timezone: timezone && isValidTimeZone(timezone) ? timezone : null,
    emailVerifiedAt: now(),
    defaultEventLocationKind: defaultLocationFor(provider, profile),
  };
}

/** Audit details of everything an unverified account loses when a provider proves its address. */
const CLAIMED = { via: "unverified_account_claimed" } as const;

/**
 * The ways back in that someone who registered the account without owning the mailbox could have left, and that a
 * new password would not close (see the file header). Only `keepOAuthAccountId`, the provider proving the address,
 * stays linked. Call inside the linking transaction, under the user row lock.
 */
async function dropAccessGrantedBeforeProof(db: DbOrTx, user: UserRow, keepOAuthAccountId: string | null, at: Date): Promise<void> {
  const logins = await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, user.id), keepOAuthAccountId ? ne(oauthAccounts.id, keepOAuthAccountId) : undefined))
    .returning({ provider: oauthAccounts.provider, email: oauthAccounts.email });
  // Cascades to the calendars, their cached events and watch channels; destinations on them fall back to none.
  const connections = await db
    .delete(calendarConnections)
    .where(eq(calendarConnections.userId, user.id))
    .returning({
      id: calendarConnections.id,
      provider: calendarConnections.provider,
      email: calendarConnections.accountEmail,
      status: calendarConnections.status,
    });
  await db.delete(apiTokens).where(eq(apiTokens.userId, user.id));
  await db.delete(calendarFeeds).where(eq(calendarFeeds.userId, user.id));
  await db.delete(webhookSubscriptions).where(or(eq(webhookSubscriptions.userId, user.id), eq(webhookSubscriptions.creatorUserId, user.id)));
  await db
    .update(organizationInvitations)
    .set({ status: "revoked", updatedAt: at })
    .where(and(eq(organizationInvitations.invitedByUserId, user.id), eq(organizationInvitations.status, "pending")));

  for (const login of logins) {
    await auditAuth("login_method.disconnected", { user, details: { provider: login.provider, email: login.email, ...CLAIMED }, tx: db });
  }
  // A connection the user already disconnected was audited then.
  const live = connections.filter((c) => c.status !== "disconnected");
  if (!live.length) return;
  const organizationId = await primaryOrganizationId(user.id, db);
  for (const c of live) {
    await audit(
      {
        action: "calendar.disconnected",
        namespace: "calendars",
        targetType: "calendar_connection",
        targetId: c.id,
        details: { provider: c.provider, email: c.email, ...CLAIMED },
        actor: { type: "user", userId: user.id, organizationId, label: user.name ?? user.email },
      },
      db,
    );
  }
}

/**
 * The provider vouched for the address of an existing account. A verified account is returned as is. An unverified one
 * becomes verified and loses everything that was set before the address was proven (password, 2FA, recovery codes,
 * sessions, outstanding emailed tokens, and every sign-in method and grant of access but `keepOAuthAccountId`, see
 * dropAccessGrantedBeforeProof), so whoever registered it without owning the mailbox is locked out. Call inside the
 * linking transaction.
 */
async function claimForVerifiedEmail(
  db: DbOrTx,
  stale: UserRow,
  keepOAuthAccountId: string | null,
): Promise<{ user: UserRow; secured: boolean }> {
  // Re-read under a row lock: the row passed in may have been read before the transaction.
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, stale.id), isNull(users.deletedAt)))
    .limit(1)
    .for("update");
  if (!user) throw new OAuthFlowError("failed", "account vanished");
  if (user.emailVerifiedAt) return { user, secured: false };
  const at = now();
  await dropAccessGrantedBeforeProof(db, user, keepOAuthAccountId, at);
  // Read back after the removals: a destination calendar among them is now none.
  const [claimed] = await db
    .update(users)
    .set({ emailVerifiedAt: at, passwordHash: null, twoFactorEnabled: false, twoFactorSecretEnc: null, updatedAt: at })
    .where(eq(users.id, user.id))
    .returning();
  if (!claimed) throw new OAuthFlowError("failed", "account vanished");
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, user.id));
  await db.update(authTokens).set({ usedAt: at }).where(and(eq(authTokens.userId, user.id), isNull(authTokens.usedAt)));
  await revokeAllSessions(user.id, db);
  if (user.passwordHash) await auditAuth("user.password_changed", { user, details: CLAIMED, tx: db });
  if (user.twoFactorEnabled) await auditAuth("user.two_factor_disabled", { user, details: CLAIMED, tx: db });
  return { user: claimed, secured: true };
}

/**
 * Step 2 of resolveOAuthLogin: an account linked to the provider without any picture adopts the provider's (https
 * only, like every provider avatar the app shows). Call inside the linking transaction, after claimForVerifiedEmail
 * (which holds the row lock); an avatar set concurrently is never replaced.
 */
async function adoptProviderAvatar(db: DbOrTx, user: UserRow, profile: OAuthProfile): Promise<UserRow> {
  const picture = profile.avatarUrl?.trim();
  if (!picture || !/^https:\/\//i.test(picture) || user.avatarUrl || user.avatarFileId) return user;
  const [updated] = await db
    .update(users)
    .set({ avatarUrl: picture, updatedAt: now() })
    .where(and(eq(users.id, user.id), isNull(users.avatarUrl), isNull(users.avatarFileId)))
    .returning();
  return updated ?? user;
}

/** Intents login and signup (see the file header). */
export async function resolveOAuthLogin(p: {
  provider: OAuthProviderId;
  profile: OAuthProfile;
  timezone?: string | null;
  db?: DbOrTx;
}): Promise<OAuthResolution> {
  const db = p.db ?? (await getDb());
  const { provider, profile } = p;
  const linked = await findLinkedAccount(db, provider, profile.providerAccountId);
  if (linked && !linked.userDeleted) {
    await touchLinkedAccount(db, linked.oauthAccountId, profile);
    return { user: await loadUser(db, linked.userId), oauthAccountId: linked.oauthAccountId, created: false, linked: false };
  }
  if (linked?.userDeleted) await dropStaleLink(db, linked);
  if (!profile.emailVerified) throw new OAuthFlowError("email_unverified");

  const existing = await findUserByEmail(db, profile.email);
  if (existing) {
    return withTx(db, async (tx) => {
      const oauthAccountId = await insertOAuthAccount(tx, existing.id, provider, profile);
      const { user, secured } = await claimForVerifiedEmail(tx, existing, oauthAccountId);
      return { user: await adoptProviderAvatar(tx, user, profile), oauthAccountId, created: false, linked: true, securedUnverifiedAccount: secured };
    });
  }

  try {
    return await withTx(db, async (tx) => {
      const { user } = await createAccountUnderPolicy(tx, signupFields(provider, profile, p.timezone));
      const oauthAccountId = await insertOAuthAccount(tx, user.id, provider, profile);
      return { user, oauthAccountId, created: true, linked: false };
    });
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") throw new OAuthFlowError("signups_closed");
    if (isAppError(e) && e.code === "conflict") {
      // A concurrent signup with the same email committed first: link to it instead.
      const winner = await findUserByEmail(db, profile.email);
      if (winner) {
        return withTx(db, async (tx) => {
          const oauthAccountId = await insertOAuthAccount(tx, winner.id, provider, profile);
          const { user, secured } = await claimForVerifiedEmail(tx, winner, oauthAccountId);
          return { user: await adoptProviderAvatar(tx, user, profile), oauthAccountId, created: false, linked: true, securedUnverifiedAccount: secured };
        });
      }
    }
    throw e;
  }
}

/** Intent link_login_method: connects the provider to the signed-in user (AU-10). */
export async function linkOAuthLoginMethod(p: {
  userId: string;
  provider: OAuthProviderId;
  profile: OAuthProfile;
  db?: DbOrTx;
}): Promise<OAuthResolution> {
  const db = p.db ?? (await getDb());
  const linked = await findLinkedAccount(db, p.provider, p.profile.providerAccountId);
  if (linked && !linked.userDeleted && linked.userId !== p.userId) throw new OAuthFlowError("account_linked_elsewhere");
  if (linked && !linked.userDeleted) {
    await touchLinkedAccount(db, linked.oauthAccountId, p.profile);
    return { user: await loadUser(db, p.userId), oauthAccountId: linked.oauthAccountId, created: false, linked: false };
  }
  if (linked?.userDeleted) await dropStaleLink(db, linked);
  const oauthAccountId = await insertOAuthAccount(db, p.userId, p.provider, p.profile);
  return { user: await loadUser(db, p.userId), oauthAccountId, created: false, linked: true };
}

export type InvitationResolution = OAuthResolution & { invitation: PendingInvitation };

/** Intent accept_invitation (AU-11, TM-03; see the file header). */
export async function acceptInvitationWithOAuth(p: {
  provider: OAuthProviderId;
  profile: OAuthProfile;
  invitationToken: string;
  timezone?: string | null;
  db?: DbOrTx;
}): Promise<InvitationResolution> {
  const db = p.db ?? (await getDb());
  const invitation = p.invitationToken ? await getPendingInvitation(p.invitationToken) : null;
  if (!invitation) throw new OAuthFlowError("invitation_invalid");
  if (!p.profile.emailVerified) throw new OAuthFlowError("email_unverified");
  if (normalizeEmail(p.profile.email) !== invitation.emailNormalized) throw new OAuthFlowError("invitation_email_mismatch");

  try {
    return await withTx(db, async (tx) => {
      const linked = await findLinkedAccount(tx, p.provider, p.profile.providerAccountId);
      if (linked?.userDeleted) await dropStaleLink(tx, linked);
      let user: UserRow;
      let oauthAccountId: string;
      let created = false;
      let linkedNow = false;
      let secured = false;
      if (linked && !linked.userDeleted) {
        user = await loadUser(tx, linked.userId);
        oauthAccountId = linked.oauthAccountId;
        await touchLinkedAccount(tx, oauthAccountId, p.profile);
      } else {
        const existing = await findUserByEmail(tx, p.profile.email);
        if (existing) {
          // Nothing to keep yet: the provider is linked right below, after the claim.
          ({ user, secured } = await claimForVerifiedEmail(tx, existing, null));
          linkedNow = true;
        } else {
          const res = await createAccountUnderPolicy(
            tx,
            {
              ...signupFields(p.provider, p.profile, p.timezone),
              email: invitation.email,
              organizationId: invitation.organizationId,
              role: invitation.role,
              createdViaInvitationId: invitation.id,
            },
            { bypassPolicy: true },
          );
          user = res.user;
          created = true;
        }
        oauthAccountId = await insertOAuthAccount(tx, user.id, p.provider, p.profile);
      }
      await acceptInvitationInTx(tx, { invitationId: invitation.id, userId: user.id });
      return { user, oauthAccountId, created, linked: linkedNow, securedUnverifiedAccount: secured, invitation };
    });
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") throw new OAuthFlowError("invitation_invalid");
    if (isAppError(e) && e.code === "conflict") throw new OAuthFlowError("invitation_conflict", e.message);
    throw e;
  }
}

/** Rejects flows that need a signed-in user when the session no longer matches the user who started it. */
export function assertSameUser(stateUserId: string | null, sessionUserId: string | null): string {
  if (!stateUserId || !sessionUserId || stateUserId !== sessionUserId) throw new OAuthFlowError("sign_in_required");
  return sessionUserId;
}


