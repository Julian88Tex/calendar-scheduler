// Booking page data (SPEC BK-03 to BK-09, BK-15, BK-23 to BK-27, BK-33, ET-10, ET-29). Server only.
//
// Turns a resolved booking target (booking-core) into the serializable props of the client flow: the event view with
// public-safe locations (VID-02, VID-04, VID-05) and enabled questions, the host header (BK-03), branding and display
// parameters (BK-25, BK-26), prefill (BK-15), the viewer's role (owner banner, troubleshoot, preview, mutual
// availability), the bot protection token (BK-18) and the deep link check of a details URL (BK-08).
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { teams, users } from "@/db/schema";
import type { PublicBranding } from "@/components/public/public-page-shell";
import { getOperatorEmail } from "@/components/public/operator";
import type { LocationConfig } from "@/db/types";
import { getCurrentUser } from "@/lib/auth/session";
import { eventTypeAccess, loadActorCtx } from "@/lib/authz";
import { getDestinationCalendar } from "@/lib/calendars";
import { allowedDurationsOf, defaultDurationOf, getAvailability, HONEYPOT_FIELD, issueBookingFormToken, TRUSTED_DEVICE_COOKIE, type BookingTarget } from "@/lib/booking";
import { parsePrefill } from "@/lib/booking/prefill";
import { APP_NAME } from "@/lib/brand";
import { embedDisplayParams } from "@/lib/embed-events";
import { getEnv } from "@/lib/env";
import { fileUrl } from "@/lib/files";
import { richTextToPlain, sanitizeRichText } from "@/lib/html";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { isValidTimeZone } from "@/lib/time/zones";
import { absoluteUrl } from "@/lib/url";
import { FRIENDS_UTM_SOURCE, type Tone } from "../lib/friends";
import { firstNameOf, friendlyEventOf, friendlyQuestionLabel, friendsLine, type FriendsContent } from "../lib/friends-content";
import type { PublicQuestion } from "../lib/form";
import { hostHeader, headerName, type HostHeader, type HostPerson } from "../lib/hosts";
import { toPublicLocations } from "../lib/locations";
import { carriedParams, param, parseDate, parseDuration, parseMonth, type SearchParamsInput } from "../lib/url-state";
import type { BookingPageProps, BrandHeaderView, EventView, ViewerView } from "../types";
import { loadFriendsContent } from "./friends";
import { getLegalLinks, loadHostProfile, loadPeople, type HostProfile } from "./host";

export const PREVIEW_SLUG = "__preview__";
const DAY_MS = 86_400_000;

export type PageShellInfo = {
  hostName: string;
  branding: PublicBranding;
  ribbon: boolean;
  privacyUrl: string | null;
  operatorEmail: string | null;
  embed: ReturnType<typeof embedDisplayParams>;
  tone?: Tone;
};

export type BookingPageResult =
  | { state: "ok"; props: BookingPageProps; meta: PageMeta }
  | { state: "off" | "used" | "expired"; shell: PageShellInfo; meta: PageMeta };

export type PageMeta = { title: string; ogTitle: string; ogImage: string | null; noindex: boolean };

type Viewer = { user: Awaited<ReturnType<typeof getCurrentUser>>; isHost: boolean; canEdit: boolean };

async function viewerOf(target: BookingTarget): Promise<Viewer> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { user: null, isHost: false, canEdit: false };
  const et = target.eventType;
  const isHost = et.ownerUserId === user.id || et.hosts.some((h) => h.userId === user.id);
  let canEdit = false;
  try {
    const actor = await loadActorCtx(await getDb(), user);
    const access = await eventTypeAccess(actor, et.id);
    canEdit = access === "owner" || access === "edit";
  } catch (e) {
    log.warn("booking.viewer_access_failed", { error: e });
  }
  return { user, isHost, canEdit };
}

async function teamOf(teamId: string | null): Promise<{ name: string; avatarUrl: string | null } | null> {
  if (!teamId) return null;
  const db = await getDb();
  const [t] = await db
    .select({ name: teams.name, avatarFileId: teams.avatarFileId })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);
  return t ? { name: t.name, avatarUrl: t.avatarFileId ? fileUrl(t.avatarFileId) : null } : null;
}

/** The host header people of an event type (BK-03). */
async function headerOf(target: BookingTarget, owner: HostProfile | null): Promise<HostHeader> {
  const et = target.eventType;
  const hostRows = [...et.hosts].sort((a, b) => a.position - b.position);
  const people = await loadPeople([...(owner ? [owner.id] : []), ...hostRows.map((h) => h.userId)]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const pick = (ids: string[]): HostPerson[] => ids.map((id) => byId.get(id)).filter((p): p is HostPerson => Boolean(p));
  const ownerPerson: HostPerson | null = owner ? { id: owner.id, name: owner.name, avatarUrl: owner.avatarUrl } : null;
  return hostHeader({
    poolingType: et.poolingType ?? null,
    scope: et.scope,
    owner: et.scope === "team" ? null : ownerPerson,
    required: pick(hostRows.filter((h) => !h.poolId).map((h) => h.userId)),
    pooled: pick(hostRows.filter((h) => h.poolId).map((h) => h.userId)),
    poolCount: et.pools.length,
    team: await teamOf(et.teamId),
  });
}

function questionsOf(target: BookingTarget): PublicQuestion[] {
  return [...target.eventType.questions]
    .filter((q) => q.enabled)
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      required: q.required,
      answerChoices: [...q.answerChoices],
      includeOther: q.includeOther,
      position: q.position,
    }));
}

/**
 * The location options invitees may pick (VID-07): Google Meet needs a Google destination calendar, so when the host
 * has none, booking pages hide the Meet option of an event type that offers other locations too (Meet as the only
 * option stays: the meeting is booked with "Web conferencing details to follow.").
 */
async function offeredLocations(target: BookingTarget): Promise<LocationConfig[]> {
  const et = target.eventType;
  const list = target.overrides?.locations ?? et.locations;
  const organizer = et.ownerUserId ?? et.hosts[0]?.userId ?? null;
  if (!organizer || list.length < 2 || !list.some((l) => l.kind === "google_conference")) return list;
  try {
    const dest = await getDestinationCalendar(organizer, et.id);
    if (dest?.supports.googleMeet) return list;
  } catch (e) {
    log.warn("booking.destination_lookup_failed", { error: e });
    return list;
  }
  const rest = list.filter((l) => l.kind !== "google_conference");
  return rest.length > 0 ? rest : list;
}

function eventViewOf(target: BookingTarget, locations: readonly LocationConfig[]): EventView {
  const et = target.eventType;
  const durations = allowedDurationsOf(target);
  const html = sanitizeRichText(et.descriptionHtml);
  return {
    id: et.id,
    name: target.overrides?.name?.trim() || et.name,
    color: et.color,
    kind: et.kind,
    durations,
    defaultDuration: defaultDurationOf(target),
    descriptionHtml: html || null,
    descriptionText: html ? null : et.descriptionPlain?.trim() || null,
    locations: toPublicLocations(locations),
    questions: questionsOf(target),
    nameFormat: et.nameFormat,
    allowGuests: et.allowGuests && et.kind !== "group",
    collectMarketingConsent: et.collectMarketingConsent,
    autofill: et.autofillInvitee,
    showRemainingSpots: et.kind === "group" && et.showRemainingSpots,
    lockedTimeZone: et.timeZoneDisplay === "locked" && isValidTimeZone(et.lockedTimeZone) ? et.lockedTimeZone : null,
    active: et.active,
    secret: et.secret,
    locale: et.locale || "en",
  };
}

function brandingOf(profile: HostProfile | null, embed: ReturnType<typeof embedDisplayParams>): PublicBranding {
  return {
    primaryColor: embed.primaryColor ?? profile?.brandColors.primary ?? null,
    backgroundColor: embed.backgroundColor ?? profile?.brandColors.background ?? null,
    textColor: embed.textColor ?? profile?.brandColors.text ?? null,
  };
}

function brandHeaderOf(profile: HostProfile | null, header: HostHeader): BrandHeaderView {
  if (profile?.logoUrl) return { kind: "logo", src: profile.logoUrl };
  if (header.variant === "single") return { kind: "avatar", src: header.person.avatarUrl, name: header.person.name };
  if (header.variant === "team") return { kind: "avatar", src: header.avatarUrl, name: header.name };
  return null;
}

/** The Turnstile site key when both keys are set (the server then requires a token on every booking, BK-18). */
function turnstileSiteKey(): string | null {
  const env = getEnv();
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/** True when the start is a bookable slot right now (deep link check, BK-08). Errors count as bookable (submit rechecks). */
async function startIsBookable(target: BookingTarget, start: Date, durationMinutes: number): Promise<boolean> {
  try {
    const r = await getAvailability({
      target,
      start: new Date(start.getTime() - DAY_MS),
      end: new Date(start.getTime() + DAY_MS),
      durationMinutes,
      now: now(),
      freshness: "page",
    });
    return r.slots.some((s) => s.start === start.getTime());
  } catch (e) {
    log.warn("booking.deep_link_check_failed", { error: e });
    return true;
  }
}

export type LoadBookingPageInput = {
  target: BookingTarget;
  /** "/{handle}/{eventSlug}" or "/d/{code}/{slug}". */
  basePath: string;
  landingPath: string | null;
  searchParams: SearchParamsInput;
  mode: "calendar" | "details";
  start?: Date | null;
  /** "friends": friends mode (?friends=1, lib/friends.ts). Default "public". */
  tone?: Tone;
};

/**
 * The friends link version of a page (lib/friends.ts): friendly event name, blurb and question wording, the warm theme
 * instead of the host's branding colors and no "Powered by" ribbon, never indexed, and bookings tagged with
 * utm_source=friends-link unless the link carries its own.
 */
function asFriendsPage(r: BookingPageResult, slug: string, content: FriendsContent): BookingPageResult {
  const noBranding: PublicBranding = { primaryColor: null, backgroundColor: null, textColor: null };
  if (r.state !== "ok") return { ...r, shell: { ...r.shell, branding: noBranding, ribbon: false, tone: "friends" }, meta: { ...r.meta, noindex: true } };
  const p = r.props;
  const friendly = friendlyEventOf(content, slug);
  const event: EventView = {
    ...p.event,
    name: friendly?.name || p.event.name,
    descriptionHtml: friendly?.blurb ? null : p.event.descriptionHtml,
    descriptionText: friendly?.blurb || p.event.descriptionText,
    questions: p.event.questions.map((q) => ({ ...q, label: friendlyQuestionLabel(q.label) })),
  };
  const firstName = firstNameOf(p.hostName);
  return {
    state: "ok",
    props: {
      ...p,
      tone: "friends",
      friendsCopy: { detailsIntro: content.detailsIntro },
      event,
      branding: noBranding,
      ribbon: false,
      prefill: { ...p.prefill, tracking: { utmSource: FRIENDS_UTM_SOURCE, ...p.prefill.tracking } },
    },
    meta: { ...r.meta, title: friendsLine("pageTitle", firstName), ogTitle: `${friendsLine("pageTitle", firstName)}: ${event.name}`, noindex: true },
  };
}

/** The booking page of a target (see the file header). */
export async function loadBookingPage(input: LoadBookingPageInput): Promise<BookingPageResult> {
  const r = await loadPage(input);
  if (input.tone !== "friends") return r;
  const et = input.target.eventType;
  return asFriendsPage(r, et.slug, await loadFriendsContent(et.ownerUserId ?? et.hosts[0]?.userId ?? null));
}

async function loadPage(input: LoadBookingPageInput): Promise<BookingPageResult> {
  const { target, searchParams: sp } = input;
  const et = target.eventType;
  const embed = embedDisplayParams(sp);
  const ownerId = et.ownerUserId ?? et.hosts[0]?.userId ?? null;
  const [profile, viewer, legal, operatorEmail, locations] = await Promise.all([
    ownerId ? loadHostProfile(ownerId) : Promise.resolve(null),
    viewerOf(target),
    getLegalLinks(),
    getOperatorEmail(),
    offeredLocations(target),
  ]);
  const header = await headerOf(target, profile);
  const event = eventViewOf(target, locations);
  const hostName = headerName(header) ?? profile?.name ?? "";
  // Team pages carry the team's identity, never the first host's personal branding.
  const brandProfile = et.scope === "team" ? null : profile;
  const branding = brandingOf(brandProfile, embed);
  const ribbon = brandProfile?.showBranding ?? true;
  const privacyUrl = profile?.privacyUrl ?? legal.privacyUrl;
  const ogImage = header.variant === "single" ? header.person.avatarUrl : header.variant === "team" ? header.avatarUrl : null;
  const meta: PageMeta = {
    title: input.mode === "details" ? "Enter Details" : "Select a Date & Time",
    ogTitle: `${hostName} - ${event.name}`,
    ogImage: ogImage ? absoluteUrl(ogImage) : null,
    noindex: et.secret || target.kind !== "event_type" || !et.active || input.mode === "details",
  };
  const shell: PageShellInfo = { hostName, branding, ribbon, privacyUrl, operatorEmail, embed };

  // BK-23 states: links already used or expired; event types turned off (the host still sees the page).
  if (target.linkStatus === "used") return { state: "used", shell, meta: { ...meta, noindex: true } };
  if (target.linkStatus === "expired") return { state: "expired", shell, meta: { ...meta, noindex: true } };
  if (!et.active && !viewer.isHost) return { state: "off", shell, meta: { ...meta, noindex: true } };

  const durations = event.durations;
  const prefill = parsePrefill(sp, {
    questions: event.questions.map((q) => ({ id: q.id, position: q.position, type: q.type, answerChoices: q.answerChoices })),
    durationOptions: durations,
  });
  const duration = parseDuration(param(sp, "duration"), durations) ?? prefill.durationMinutes ?? null;
  const start = input.mode === "details" && input.start ? input.start : null;
  const startAvailable = start ? await startIsBookable(target, start, duration ?? event.defaultDuration) : null;

  const viewerView: ViewerView = {
    signedIn: Boolean(viewer.user),
    isHost: viewer.isHost,
    email: viewer.isHost ? (viewer.user?.email ?? null) : null,
    editUrl: viewer.canEdit ? `/app/event-types/${et.id}` : null,
    mutual: Boolean(viewer.user) && !viewer.isHost && !embed.embed,
  };
  const preview = param(sp, "preview") === "1" && viewer.canEdit;

  const props: BookingPageProps = {
    mode: input.mode,
    basePath: input.basePath,
    landingPath: input.landingPath,
    canonicalUrl: absoluteUrl(input.basePath),
    target:
      target.kind === "event_type"
        ? { kind: "event_type", eventTypeId: et.id }
        : { kind: target.kind, code: target.code, eventTypeId: et.id },
    slotsTarget: target.kind === "event_type" ? et.id : (target.code ?? null),
    event,
    host: header,
    hostName,
    brandHeader: brandHeaderOf(brandProfile, header),
    branding,
    ribbon,
    initial: {
      month: parseMonth(param(sp, "month")),
      date: parseDate(param(sp, "date")),
      start: start ? start.toISOString() : null,
      startAvailable,
      duration,
      back: param(sp, "back") === "1" && Boolean(input.landingPath),
    },
    prefill: {
      ...prefill,
      tracking: Object.fromEntries(Object.entries(prefill.tracking).filter((e): e is [string, string] => typeof e[1] === "string")),
    },
    carry: carriedParams(sp).filter(([k]) => k !== "preview" || preview),
    embed,
    formToken: await issueBookingFormToken(),
    honeypotName: HONEYPOT_FIELD,
    trustedDeviceCookie: TRUSTED_DEVICE_COOKIE,
    viewer: viewerView,
    preview,
    troubleshootEventTypeId: viewer.isHost ? et.id : null,
    turnstileSiteKey: turnstileSiteKey(),
    serverNow: now().getTime(),
    hostZone: profile?.timezone ?? "UTC",
    weekStart: profile?.weekStart ?? 0,
    operatorEmail,
    privacyUrl,
    termsUrl: legal.termsUrl,
    appName: APP_NAME,
    confirmationBase: "/booking",
  };
  return { state: "ok", props, meta };
}

/** The editor preview of an unsaved event type (/{handle}/__preview__?preview=1, ARCHITECTURE 17.1): owners only. */
export async function loadNewTypePreview(handle: string, sp: SearchParamsInput): Promise<BookingPageResult | null> {
  if (param(sp, "preview") !== "1") return null;
  const user = await getCurrentUser().catch(() => null);
  if (!user || (user.slug ?? "").toLowerCase() !== handle.toLowerCase()) return null;
  const db = await getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, user.id), isNull(users.deletedAt))).limit(1);
  if (!u) return null;
  const profile = await loadHostProfile(u.id);
  if (!profile) return null;
  const [legal, operatorEmail] = await Promise.all([getLegalLinks(), getOperatorEmail()]);
  const embed = embedDisplayParams(sp);
  const person: HostPerson = { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl };
  const header: HostHeader = { variant: "single", person };
  const event: EventView = {
    id: null,
    name: "",
    color: "#8247f5",
    kind: "solo",
    durations: [30],
    defaultDuration: 30,
    descriptionHtml: null,
    descriptionText: null,
    locations: [],
    questions: [],
    nameFormat: "full",
    allowGuests: true,
    collectMarketingConsent: false,
    autofill: false,
    showRemainingSpots: false,
    lockedTimeZone: null,
    active: true,
    secret: true,
    locale: profile.locale,
  };
  const basePath = `/${handle}/${PREVIEW_SLUG}`;
  const props: BookingPageProps = {
    mode: "calendar",
    basePath,
    landingPath: `/${handle}`,
    canonicalUrl: absoluteUrl(basePath),
    target: { kind: "event_type" },
    slotsTarget: null,
    event,
    host: header,
    hostName: profile.name,
    brandHeader: brandHeaderOf(profile, header),
    branding: brandingOf(profile, embed),
    ribbon: profile.showBranding,
    initial: { month: null, date: null, start: null, startAvailable: null, duration: null, back: false },
    prefill: { answers: {}, guests: [], tracking: {} },
    carry: [["preview", "1"]],
    embed,
    formToken: "",
    honeypotName: HONEYPOT_FIELD,
    trustedDeviceCookie: TRUSTED_DEVICE_COOKIE,
    viewer: { signedIn: true, isHost: false, email: null, editUrl: null, mutual: false },
    preview: true,
    troubleshootEventTypeId: null,
    turnstileSiteKey: null,
    serverNow: now().getTime(),
    hostZone: profile.timezone,
    weekStart: profile.weekStart,
    operatorEmail,
    privacyUrl: profile.privacyUrl ?? legal.privacyUrl,
    termsUrl: legal.termsUrl,
    appName: APP_NAME,
    confirmationBase: "/booking",
  };
  return { state: "ok", props, meta: { title: "Preview", ogTitle: profile.name, ogImage: null, noindex: true } };
}

/** Plain text of a description (Open Graph description). */
export function descriptionOf(props: BookingPageProps): string | null {
  const text = props.event.descriptionText ?? (props.event.descriptionHtml ? richTextToPlain(props.event.descriptionHtml) : null);
  return text ? text.replace(/\s+/g, " ").slice(0, 200) : null;
}
