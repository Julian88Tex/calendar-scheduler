// Voter page loader (SPEC MP-07 to MP-15, MP-30; ARCHITECTURE 26 rule 11): resolves /p/{slug} through polls-core's
// getVoterView with the voter's identity (edit cookie or embed fallback, ?i= invite token, signed-in user), the stored
// "Check my calendar" result, a fresh bot check token, the owner's branding and the public shell settings. Old link
// endings redirect (to the magic edit path when the request carried a valid edit cookie, so "Edit your preferred
// times" survives the move). Server only.
import "server-only";
import { loadHostProfile } from "@/components/booking/server/host";
import { getOperatorEmail } from "@/components/public/operator";
import { getCurrentUser } from "@/lib/auth/session";
import { isOAuthErrorCode, oauthErrorMessage } from "@/lib/auth/oauth/errors";
import { embedDisplayParams } from "@/lib/embed-events";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { getVoterView, issuePollFormToken, readCheckCookieFromHeaders, readEditTokenFromHeaders, readVoterCalendarCheck } from "@/lib/polls/server";
import { pt } from "../lib/t";
import type { VoterPageProps, VoterShell } from "../types";

export type SearchParams = Record<string, string | string[] | undefined>;

export type VoterPageResult =
  | { kind: "ok"; props: VoterPageProps }
  | { kind: "redirect"; to: string; permanent: boolean }
  | { kind: "not_found" }
  | { kind: "gone"; shell: VoterShell };

function one(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

/** A /p/{slug} path segment as polls-core expects it (lowercase letters, numbers, hyphens), else null. */
export function normalizeSlug(raw: string): string | null {
  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    return null;
  }
  v = v.trim().toLowerCase();
  return v && v.length <= 100 && /^[a-z0-9-]+$/.test(v) ? v : null;
}

/** Query parameters kept across a canonical slug redirect (invite token and embed display parameters). */
const KEEP = ["i", "embed_type", "embed_domain", "background_color", "text_color", "primary_color", "hide_gdpr_banner", "hide_event_type_details"];

function keptQuery(sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const k of KEEP) {
    const v = one(sp, k);
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function turnstileSiteKey(): string | null {
  const env = getEnv();
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

async function shellFor(ownerUserId: string | null, sp: SearchParams): Promise<VoterShell> {
  const embed = embedDisplayParams(sp);
  const [profile, operatorEmail] = await Promise.all([
    ownerUserId ? loadHostProfile(ownerUserId).catch((e: unknown) => (log.warn("polls.voter_profile_failed", { error: e }), null)) : Promise.resolve(null),
    getOperatorEmail(),
  ]);
  return {
    branding: {
      primaryColor: embed.primaryColor ?? profile?.brandColors.primary ?? null,
      backgroundColor: embed.backgroundColor ?? profile?.brandColors.background ?? null,
      textColor: embed.textColor ?? profile?.brandColors.text ?? null,
    },
    logoUrl: profile?.logoUrl ?? null,
    ribbon: profile ? profile.showBranding : true,
    embed: embed.embed,
    hideGdprBanner: embed.hideGdprBanner,
    operatorEmail,
    privacyUrl: profile?.privacyUrl ?? null,
  };
}

export async function loadVoterPage(rawSlug: string, sp: SearchParams): Promise<VoterPageResult> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return { kind: "not_found" };
  const inviteToken = one(sp, "i")?.slice(0, 200) ?? null;
  const [user, editToken] = await Promise.all([getCurrentUser(), readEditTokenFromHeaders()]);
  const result = await getVoterView(slug, {
    editToken,
    inviteToken,
    userId: user?.id ?? null,
    viewer: user ? { userId: user.id, name: user.name, email: user.email } : null,
  });
  if (result.status === 404) return { kind: "not_found" };
  if (result.status === 410) return { kind: "gone", shell: await shellFor(null, sp) };
  if (result.status === 301) {
    return result.editPath
      ? { kind: "redirect", to: result.editPath, permanent: false }
      : { kind: "redirect", to: `/p/${encodeURIComponent(result.canonicalSlug)}${keptQuery(sp)}`, permanent: true };
  }
  const view = result.view;
  const owner = view.poll.hosts.find((h) => h.role === "owner") ?? view.poll.hosts[0] ?? null;
  const [calendarCheck, formToken, shell] = await Promise.all([
    readCheckCookieFromHeaders().then((c) => readVoterCalendarCheck(result.canonicalSlug, c)),
    issuePollFormToken(),
    shellFor(owner?.userId ?? null, sp),
  ]);
  const oauthCode = one(sp, "oauth_error");
  const provider = one(sp, "provider");
  return {
    kind: "ok",
    props: {
      slug: result.canonicalSlug,
      view,
      inviteToken,
      formToken,
      turnstileSiteKey: turnstileSiteKey(),
      calendarCheck,
      flags: {
        calendarChecked: one(sp, "calendar") === "checked" && Boolean(calendarCheck),
        linkExpired: one(sp, "link") === "expired",
        oauthError: oauthCode
          ? isOAuthErrorCode(oauthCode)
            ? oauthErrorMessage(oauthCode, { provider: provider === "google" || provider === "microsoft" ? provider : null })
            : pt("voter.calendarCheckFailed")
          : null,
      },
      resultsHref: view.viewerIsHost ? `/app/polls/${result.pollId}` : null,
      shell,
    },
  };
}

/** Document metadata of the voter page: "{Host name}: {Poll title}", never indexed (MP-30). */
export function voterMetadataTitle(view: VoterPageProps["view"]): { title: string; ogTitle: string } {
  const owner = view.poll.hosts.find((h) => h.role === "owner") ?? view.poll.hosts[0];
  return { title: view.poll.title, ogTitle: owner ? `${owner.name}: ${view.poll.title}` : view.poll.title };
}
