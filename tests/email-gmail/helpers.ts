// Shared setup for the Gmail transport tests: the instance owner with a Google connection (encrypted tokens, the
// calendar scopes plus gmail.send), and a fake Gmail API plus Google token endpoint whose answers each test programs.
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { calendarConnections } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { GMAIL_SEND_SCOPE } from "@/lib/integrations/google/scopes";
import { nowMs } from "@/lib/time/now";
import { createCalendarConnection, type TestUser } from "../factories";
import { mockFetch, mockResponse, type MockFetch, type MockRequest } from "../helpers/fake-providers";
import { decodeGmailRaw, parseMime, type MimePart } from "./mime";

export const CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
export const GMAIL_SCOPES = [...CALENDAR_SCOPES, GMAIL_SEND_SCOPE];
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type Connection = { id: string; address: string };

/** A Google connection of `user` with real (encrypted) tokens. */
export async function connectGoogle(
  db: DbOrTx,
  user: TestUser,
  opts: { address?: string; scopes?: string[]; accessToken?: string; refreshToken?: string; expiresAt?: Date; status?: "active" | "needs_reauth" | "error" } = {},
): Promise<Connection> {
  const address = opts.address ?? "jordan.lee@gmail.com";
  const { connection } = await createCalendarConnection(db, { userId: user.id, accountEmail: address, status: opts.status ?? "active" });
  await db
    .update(calendarConnections)
    .set({
      accessTokenEnc: await encrypt(opts.accessToken ?? "access-1"),
      refreshTokenEnc: await encrypt(opts.refreshToken ?? "refresh-1"),
      tokenExpiresAt: opts.expiresAt ?? new Date(nowMs() + 24 * 3600_000),
      scopes: opts.scopes ?? GMAIL_SCOPES,
    })
    .where(eq(calendarConnections.id, connection.id));
  return { id: connection.id, address };
}

/** Puts a connection back to healthy with fresh tokens (what a reconnect through Google's consent screen does). */
export async function reconnect(db: DbOrTx, connectionId: string, opts: { accessToken?: string; scopes?: string[] } = {}): Promise<void> {
  await db
    .update(calendarConnections)
    .set({
      status: "active",
      lastError: null,
      consecutiveFailures: 0,
      accessTokenEnc: await encrypt(opts.accessToken ?? "access-reconnected"),
      refreshTokenEnc: await encrypt("refresh-reconnected"),
      tokenExpiresAt: new Date(nowMs() + 24 * 3600_000),
      scopes: opts.scopes ?? GMAIL_SCOPES,
    })
    .where(eq(calendarConnections.id, connectionId));
}

export type GmailCall = { authorization: string | null; raw: string; message: MimePart; upload: boolean };

export type FakeGmail = {
  fetch: MockFetch;
  /** Messages Gmail accepted or refused, in order. */
  calls: GmailCall[];
  tokenCalls: MockRequest[];
  /** Queue of answers for the next sends (default: 200 with a message id). */
  sendAnswers: (Response | (() => Response))[];
  /** Queue of answers for the next token requests (default: a new access token). */
  tokenAnswers: (Response | Record<string, unknown>)[];
  restore: () => void;
};

/** Gmail error bodies as Google returns them. */
export function gmailError(status: number, reason: string, message: string, headers: Record<string, string> = {}): Response {
  return mockResponse({ error: { code: status, message, errors: [{ message, domain: "global", reason }], status: reason } }, { status, headers });
}

export function fakeGmail(): FakeGmail {
  const calls: GmailCall[] = [];
  const tokenCalls: MockRequest[] = [];
  const sendAnswers: (Response | (() => Response))[] = [];
  const tokenAnswers: (Response | Record<string, unknown>)[] = [];
  let n = 0;
  const f = mockFetch(
    {
      name: "gmail.send",
      method: "POST",
      url: GMAIL_SEND_URL,
      handler: (req) => {
        const body = req.body as { raw?: string };
        const raw = decodeGmailRaw(String(body?.raw ?? ""));
        calls.push({ authorization: req.headers.get("authorization"), raw, message: parseMime(raw), upload: false });
        const next = sendAnswers.shift();
        if (next) return typeof next === "function" ? next() : next;
        n += 1;
        return { id: `gm-${n}`, threadId: `th-${n}`, labelIds: ["SENT"] };
      },
    },
    {
      name: "google.token",
      method: "POST",
      url: TOKEN_URL,
      handler: (req) => {
        tokenCalls.push(req);
        const next = tokenAnswers.shift();
        if (next instanceof Response) return next;
        return {
          access_token: `access-refreshed-${tokenCalls.length}`,
          token_type: "Bearer",
          expires_in: 3599,
          scope: GMAIL_SCOPES.join(" "),
          ...(next ?? {}),
        };
      },
    },
  );
  return { fetch: f, calls, tokenCalls, sendAnswers, tokenAnswers, restore: f.restore };
}

/** Google's answer to a revoked or expired refresh token. */
export const invalidGrant = () => mockResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
