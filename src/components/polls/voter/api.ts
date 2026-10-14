// Voter page client of polls-core's public routes (/api/public/polls/{slug}/**; SPEC MP-08 to MP-14, GEN-08). The page
// calls the route handlers instead of Server Actions so it can always send the embed fallback header (the edit token
// mirrored in localStorage when an embed blocks the cookie): votes, edits and comments then work the same on the
// voter's device inside a third-party iframe. Client only at call time.
import { fallbackCookieHeaders, rememberFallbackCookie } from "@/lib/client/embed-cookie";
import { EDIT_COOKIE, EDIT_COOKIE_MAX_AGE_SECONDS } from "@/lib/polls/constants";
import type { ParticipantStatus, VoterCalendarCheck, VoterPollView } from "@/lib/polls/types";
import type { SubmitVoteInput } from "@/lib/polls/validation";
import { pt } from "../lib/t";

export type ApiFailure = { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]>; status: number };
export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

type Json = Record<string, unknown>;

function base(slug: string): string {
  return `/api/public/polls/${encodeURIComponent(slug)}`;
}

async function call<T extends Json>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...fallbackCookieHeaders([EDIT_COOKIE]) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "network", message: "We couldn't reach the server. Check your connection and try again.", status: 0 };
  }
  let data: Json = {};
  try {
    data = (await res.json()) as Json;
  } catch {
    data = {};
  }
  if (res.ok && data.ok !== false) return { ok: true, ...(data as T) };
  // Vote outcomes answer { ok: false, code, message }; route errors { error, message, fieldErrors }.
  const code = typeof data.code === "string" ? data.code : typeof data.error === "string" ? data.error : "internal";
  const message = typeof data.message === "string" && data.message ? data.message : pt("common.somethingWrong");
  const fieldErrors = data.fieldErrors && typeof data.fieldErrors === "object" ? (data.fieldErrors as Record<string, string[]>) : undefined;
  return { ok: false, code, message, fieldErrors, status: res.status };
}

/** The voter page data again (after a vote, a comment, or with the embed fallback token). */
export async function fetchVoterView(slug: string, inviteToken: string | null): Promise<ApiResult<{ view: VoterPollView }>> {
  const q = inviteToken ? `?i=${encodeURIComponent(inviteToken)}` : "";
  const res = await call<Json>("GET", `${base(slug)}${q}`);
  if (!res.ok) return res;
  const { ok: _ok, ...view } = res;
  void _ok;
  return { ok: true, view: view as unknown as VoterPollView };
}

export type SubmitResult = { participantId: string; status: ParticipantStatus; created: boolean; editToken: string | null };

/** "Share times" / "None of these work for me". Inside embeds the returned edit token is mirrored in localStorage. */
export async function submitVote(slug: string, input: SubmitVoteInput): Promise<ApiResult<SubmitResult>> {
  const res = await call<SubmitResult>("POST", `${base(slug)}/responses`, input);
  if (res.ok && res.editToken) rememberFallbackCookie(EDIT_COOKIE, res.editToken, EDIT_COOKIE_MAX_AGE_SECONDS);
  return res;
}

/** Sends the "Verify email" code. */
export async function requestCode(slug: string, input: { email: string; name?: string | null }): Promise<ApiResult<{ required: boolean; expiresAt: string | null }>> {
  return call("POST", `${base(slug)}/verify-email`, input);
}

export async function addComment(slug: string, input: { body: string; name?: string | null; inviteToken?: string | null }): Promise<ApiResult<{ commentId: string }>> {
  return call("POST", `${base(slug)}/comments`, input);
}

export async function deleteComment(slug: string, commentId: string, inviteToken: string | null): Promise<ApiResult<{ commentId: string }>> {
  const q = inviteToken ? `?i=${encodeURIComponent(inviteToken)}` : "";
  return call("DELETE", `${base(slug)}/comments/${encodeURIComponent(commentId)}${q}`);
}

/** "Paste an ICS link" or "Use my connected calendars" (MP-13). */
export async function checkCalendar(slug: string, input: { icsUrl?: string; source?: "account"; embed: boolean }): Promise<ApiResult<{ check: VoterCalendarCheck }>> {
  return call("POST", `${base(slug)}/freebusy`, input);
}

export async function clearCalendarCheck(slug: string, embed: boolean): Promise<ApiResult<Json>> {
  return call("DELETE", `${base(slug)}/freebusy${embed ? "?embed=1" : ""}`);
}

