// Fakes for external providers (ARCHITECTURE section 24.1): an in-memory calendar provider registry, a mockFetch
// router with ready-made route sets for Google Calendar, Microsoft Graph, Zoom, Twilio, Stripe and the Calendly API,
// a fake Stripe SDK client, and freezeTime(). Vitest only.
import { createHmac, randomUUID } from "node:crypto";
import { vi } from "vitest";

// ---------------------------------------------------------------------------------------------------------------
// Calendar provider (structurally identical to CalendarProvider in ARCHITECTURE 10.1, which calendar-integrations
// defines in src/lib/calendars/providers/types.ts; TypeScript's structural typing lets this fake be passed there).
// ---------------------------------------------------------------------------------------------------------------

export type FakeProviderId = "google" | "microsoft" | "caldav" | "ics" | "calendly_import";
export type FakeConnectionContext = {
  connectionId: string;
  userId: string;
  provider: FakeProviderId;
  accessToken?: string;
  caldav?: { serverUrl: string; username: string; password: string; principalUrl?: string };
  icsUrl?: string;
  unavailableStatuses: string[];
};
export type FakeRemoteCalendar = {
  externalId: string;
  name: string;
  color?: string | null;
  timeZone?: string | null;
  isPrimary: boolean;
  canWrite: boolean;
  allowedOnlineMeetingProviders?: string[];
};
export type FakeRemoteEvent = {
  externalId: string;
  icalUid?: string | null;
  recurringEventId?: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  allDayStartDate?: string;
  allDayEndDate?: string;
  title: string | null;
  busy: boolean;
  showAs?: string | null;
  status?: "confirmed" | "tentative" | "cancelled" | null;
  selfDeclined?: boolean;
  extendedPrivate?: Record<string, string>;
  updatedAt?: Date | null;
  etag?: string | null;
};
export type FakeWriteEventInput = {
  title: string;
  descriptionText: string;
  descriptionHtml?: string;
  location?: string | null;
  start: Date;
  end: Date;
  allDay?: boolean;
  allDayDate?: string;
  attendees: { email: string; name?: string | null; optional?: boolean }[];
  sendInvitations: boolean;
  conference?: "google_meet" | "microsoft_teams" | null;
  transparency: "busy" | "free";
  visibility?: "default" | "private";
  icalUid: string;
  idempotencyKey: string;
  privateProperties: Record<string, string>;
};
export type FakeWriteEventResult = {
  externalId: string;
  etag?: string | null;
  icalUid?: string | null;
  htmlLink?: string | null;
  conference?: { joinUrl: string | null; status: "pushed" | "processing" | "failed"; data?: Record<string, unknown> };
};
export type FakeProviderCall = { method: string; connectionId: string; args: unknown[] };

export class FakeCalendarProvider {
  id: FakeProviderId;
  capabilities: {
    write: boolean;
    invitations: boolean;
    conferences: ("google_meet" | "microsoft_teams")[];
    changeSync: boolean;
  };
  calls: FakeProviderCall[] = [];
  /** calendars per connection id */
  calendars = new Map<string, FakeRemoteCalendar[]>();
  /** events per `${connectionId}:${calendarExternalId}` */
  events = new Map<string, FakeRemoteEvent[]>();
  /** Make the next calls fail: "auth" -> ProviderAuthError-like, "transient" -> ProviderTransientError-like. */
  failNext: { kind: "auth" | "transient"; count: number } | null = null;

  constructor(id: FakeProviderId = "google") {
    this.id = id;
    const writable = id === "google" || id === "microsoft" || id === "caldav";
    this.capabilities = {
      write: writable,
      invitations: id === "google" || id === "microsoft",
      conferences: id === "google" ? ["google_meet"] : id === "microsoft" ? ["microsoft_teams"] : [],
      changeSync: id !== "ics" && id !== "calendly_import",
    };
  }

  private key(ctx: FakeConnectionContext, calendarExternalId: string) {
    return `${ctx.connectionId}:${calendarExternalId}`;
  }

  private record(method: string, ctx: FakeConnectionContext, args: unknown[]) {
    this.calls.push({ method, connectionId: ctx.connectionId, args });
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count -= 1;
      const kind = this.failNext.kind;
      if (this.failNext.count === 0) this.failNext = null;
      const err = new Error(kind === "auth" ? "fake provider: invalid_grant" : "fake provider: 503");
      err.name = kind === "auth" ? "ProviderAuthError" : "ProviderTransientError";
      throw err;
    }
  }

  /** Test setup: the calendars a connection lists. */
  setCalendars(connectionId: string, calendars: FakeRemoteCalendar[]) {
    this.calendars.set(connectionId, calendars);
  }

  /** Test setup: the events of one calendar (replaces existing ones). */
  setEvents(connectionId: string, calendarExternalId: string, events: Partial<FakeRemoteEvent>[]) {
    this.events.set(
      `${connectionId}:${calendarExternalId}`,
      events.map((e) => ({
        externalId: e.externalId ?? randomUUID(),
        start: e.start ?? new Date(),
        end: e.end ?? new Date(),
        allDay: e.allDay ?? false,
        title: e.title ?? "Busy",
        busy: e.busy ?? true,
        ...e,
      })),
    );
  }

  async listCalendars(ctx: FakeConnectionContext): Promise<FakeRemoteCalendar[]> {
    this.record("listCalendars", ctx, []);
    return this.calendars.get(ctx.connectionId) ?? [{ externalId: "primary", name: "Primary", isPrimary: true, canWrite: true }];
  }

  async listEvents(
    ctx: FakeConnectionContext,
    calendarExternalIds: string[],
    range: { start: Date; end: Date },
  ): Promise<Record<string, FakeRemoteEvent[]>> {
    this.record("listEvents", ctx, [calendarExternalIds, range]);
    const out: Record<string, FakeRemoteEvent[]> = {};
    for (const id of calendarExternalIds) {
      out[id] = (this.events.get(this.key(ctx, id)) ?? []).filter((e) => e.start < range.end && e.end > range.start);
    }
    return out;
  }

  async getEvent(ctx: FakeConnectionContext, calendarExternalId: string, externalId: string): Promise<FakeRemoteEvent | null> {
    this.record("getEvent", ctx, [calendarExternalId, externalId]);
    return (this.events.get(this.key(ctx, calendarExternalId)) ?? []).find((e) => e.externalId === externalId) ?? null;
  }

  async createEvent(ctx: FakeConnectionContext, calendarExternalId: string, input: FakeWriteEventInput): Promise<FakeWriteEventResult> {
    this.record("createEvent", ctx, [calendarExternalId, input]);
    const list = this.events.get(this.key(ctx, calendarExternalId)) ?? [];
    const existing = list.find((e) => e.extendedPrivate?.idempotencyKey === input.idempotencyKey);
    const externalId = existing?.externalId ?? `fake-${randomUUID()}`;
    if (!existing) {
      list.push({
        externalId,
        icalUid: input.icalUid,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? false,
        title: input.title,
        busy: input.transparency === "busy",
        extendedPrivate: { ...input.privateProperties, idempotencyKey: input.idempotencyKey },
        etag: "1",
      });
      this.events.set(this.key(ctx, calendarExternalId), list);
    }
    return {
      externalId,
      etag: "1",
      icalUid: input.icalUid,
      htmlLink: `https://calendar.example.com/event/${externalId}`,
      conference: input.conference
        ? { joinUrl: `https://meet.example.com/${externalId.slice(-10)}`, status: "pushed" }
        : undefined,
    };
  }

  async updateEvent(
    ctx: FakeConnectionContext,
    calendarExternalId: string,
    externalId: string,
    input: FakeWriteEventInput,
  ): Promise<FakeWriteEventResult> {
    this.record("updateEvent", ctx, [calendarExternalId, externalId, input]);
    const list = this.events.get(this.key(ctx, calendarExternalId)) ?? [];
    const ev = list.find((e) => e.externalId === externalId);
    if (ev) Object.assign(ev, { start: input.start, end: input.end, title: input.title, etag: String(Number(ev.etag ?? 1) + 1) });
    return { externalId, etag: ev?.etag ?? null, icalUid: input.icalUid };
  }

  async deleteEvent(
    ctx: FakeConnectionContext,
    calendarExternalId: string,
    externalId: string,
    opts: { notifyAttendees: boolean; comment?: string },
  ): Promise<void> {
    this.record("deleteEvent", ctx, [calendarExternalId, externalId, opts]);
    const list = this.events.get(this.key(ctx, calendarExternalId)) ?? [];
    this.events.set(
      this.key(ctx, calendarExternalId),
      list.filter((e) => e.externalId !== externalId),
    );
  }
}

const registry = new Map<FakeProviderId, FakeCalendarProvider>();

/** The fake provider for an id (created on first use; shared within a test file until resetFakeProviders()). */
export function fakeCalendarProvider(id: FakeProviderId = "google"): FakeCalendarProvider {
  let p = registry.get(id);
  if (!p) {
    p = new FakeCalendarProvider(id);
    registry.set(id, p);
  }
  return p;
}

/** A provider lookup function for vi.mock of the calendars provider registry. */
export const fakeProviderRegistry = {
  get: (id: FakeProviderId) => fakeCalendarProvider(id),
  all: () => [...registry.values()],
};

export function resetFakeProviders(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------------------------------------------
// mockFetch router
// ---------------------------------------------------------------------------------------------------------------

export type MockRequest = {
  method: string;
  url: URL;
  headers: Headers;
  /** Parsed JSON or form body (URLSearchParams entries as an object), else the raw text. */
  body: unknown;
  raw: string;
  params: string[];
};
export type MockHandler = (req: MockRequest) => unknown | Promise<unknown>;
export type MockRoute = { method?: string; url: string | RegExp | ((url: URL) => boolean); handler: MockHandler; name?: string };
export type MockFetch = {
  calls: MockRequest[];
  /** Calls whose URL contains `fragment` (and optionally a method). */
  callsTo: (fragment: string, method?: string) => MockRequest[];
  add: (...routes: MockRoute[]) => void;
  restore: () => void;
  fetch: typeof fetch;
};

/** Helper for handlers that need a status code or headers: return mockResponse(...) instead of a plain object. */
export function mockResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  if (body instanceof Response) return body;
  const isText = typeof body === "string";
  return new Response(isText ? body : body === undefined ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": isText ? "text/plain" : "application/json", ...init.headers },
  });
}

function matchRoute(route: MockRoute, method: string, url: URL): string[] | null {
  if (route.method && route.method.toUpperCase() !== method) return null;
  if (typeof route.url === "function") return route.url(url) ? [] : null;
  if (route.url instanceof RegExp) {
    const m = route.url.exec(url.toString());
    return m ? m.slice(1) : null;
  }
  return url.toString().startsWith(route.url) ? [] : null;
}

/**
 * Replaces globalThis.fetch with a router. Unmatched requests throw (so tests never reach the network).
 * Handlers return a Response, or any value (sent as JSON with status 200).
 */
export function mockFetch(...initial: MockRoute[]): MockFetch {
  const routes: MockRoute[] = [...initial];
  const calls: MockRequest[] = [];
  const original = globalThis.fetch;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const raw = method === "GET" || method === "HEAD" ? "" : await request.text();
    let body: unknown = raw;
    const type = request.headers.get("content-type") ?? "";
    if (raw && type.includes("application/json")) body = JSON.parse(raw);
    else if (raw && type.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(raw));
    for (const route of routes) {
      const params = matchRoute(route, method, url);
      if (!params) continue;
      const req: MockRequest = { method, url, headers: request.headers, body, raw, params };
      calls.push(req);
      return mockResponse(await route.handler(req));
    }
    throw new Error(`mockFetch: unexpected request ${method} ${url.toString()}`);
  }) as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    callsTo: (fragment, method) =>
      calls.filter((c) => c.url.toString().includes(fragment) && (!method || c.method === method.toUpperCase())),
    add: (...more) => routes.unshift(...more),
    restore: () => {
      vi.unstubAllGlobals();
      globalThis.fetch = original;
    },
    fetch: fn,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ready-made route sets (tech-reference sections 5 to 9)
// ---------------------------------------------------------------------------------------------------------------

export type OAuthTokenOptions = { accessToken?: string; refreshToken?: string | null; idToken?: string; scope?: string };

/** An unsigned id token (header.payload.signature) with the given claims, like the providers return. */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: Math.floor(Date.now() / 1000), ...claims })}.signature`;
}

function tokenResponse(o: OAuthTokenOptions = {}) {
  return {
    access_token: o.accessToken ?? `at-${randomUUID()}`,
    token_type: "Bearer",
    expires_in: 3599,
    ...(o.refreshToken === null ? {} : { refresh_token: o.refreshToken ?? `rt-${randomUUID()}` }),
    scope: o.scope ?? "openid email profile",
    ...(o.idToken ? { id_token: o.idToken } : {}),
  };
}

export type FakeGoogleState = {
  calendars: { id: string; summary: string; primary?: boolean; accessRole?: string; timeZone?: string }[];
  events: Record<string, { id: string; start: string; end: string; summary?: string; transparency?: string }[]>;
  busy: Record<string, { start: string; end: string }[]>;
  inserted: Record<string, unknown>[];
};

/** Google OAuth token endpoint plus Calendar v3 calendarList, freeBusy and events CRUD. */
export function googleRoutes(state: Partial<FakeGoogleState> = {}, token: OAuthTokenOptions = {}): MockRoute[] {
  const s: FakeGoogleState = { calendars: [{ id: "primary@example.com", summary: "Primary", primary: true, accessRole: "owner" }], events: {}, busy: {}, inserted: [], ...state };
  const G = "https://www.googleapis.com/calendar/v3";
  return [
    { name: "google.token", method: "POST", url: "https://oauth2.googleapis.com/token", handler: () => tokenResponse(token) },
    { name: "google.revoke", method: "POST", url: "https://oauth2.googleapis.com/revoke", handler: () => ({}) },
    {
      name: "google.userinfo",
      method: "GET",
      url: "https://openidconnect.googleapis.com/v1/userinfo",
      handler: () => ({ sub: "google-sub-1", email: "user@example.com", email_verified: true, name: "Google User" }),
    },
    {
      name: "google.calendarList",
      method: "GET",
      url: `${G}/users/me/calendarList`,
      handler: () => ({ items: s.calendars.map((c) => ({ accessRole: "owner", ...c })) }),
    },
    {
      name: "google.freeBusy",
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req) => {
        const items = ((req.body as { items?: { id: string }[] })?.items ?? []).map((i) => i.id);
        return { calendars: Object.fromEntries(items.map((id) => [id, { busy: s.busy[id] ?? [] }])) };
      },
    },
    {
      name: "google.events.list",
      method: "GET",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
      handler: (req) => ({
        items: (s.events[decodeURIComponent(req.params[0])] ?? []).map((e) => ({
          status: "confirmed",
          ...e,
          start: { dateTime: e.start },
          end: { dateTime: e.end },
        })),
      }),
    },
    {
      name: "google.events.insert",
      method: "POST",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
      handler: (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        s.inserted.push(body);
        const id = (body.id as string) ?? randomUUID().replace(/-/g, "");
        return {
          ...body,
          id,
          iCalUID: `${id}@google.com`,
          htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
          hangoutLink: body.conferenceData ? `https://meet.google.com/abc-defg-hij` : undefined,
          etag: '"1"',
        };
      },
    },
    {
      name: "google.events.patch",
      method: "PATCH",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events/([^/?]+)`),
      handler: (req) => ({ ...(req.body as object), id: req.params[1], etag: '"2"' }),
    },
    {
      name: "google.events.delete",
      method: "DELETE",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events/([^/?]+)`),
      handler: () => new Response(null, { status: 204 }),
    },
  ];
}

/** Microsoft identity token endpoint plus Graph me, calendars, calendarView and events. */
export function microsoftRoutes(
  state: { calendars?: { id: string; name: string; isDefaultCalendar?: boolean }[]; view?: Record<string, unknown[]> } = {},
  token: OAuthTokenOptions = {},
): MockRoute[] {
  const MG = "https://graph.microsoft.com/v1.0";
  const calendars = state.calendars ?? [{ id: "cal-1", name: "Calendar", isDefaultCalendar: true }];
  return [
    {
      name: "microsoft.token",
      method: "POST",
      url: /^https:\/\/login\.microsoftonline\.com\/[^/]+\/oauth2\/v2\.0\/token/,
      handler: () => tokenResponse(token),
    },
    {
      name: "graph.me",
      method: "GET",
      url: (u) => u.host === "graph.microsoft.com" && u.pathname === "/v1.0/me",
      handler: () => ({ id: "ms-oid-1", displayName: "Graph User", mail: "user@example.com", userPrincipalName: "user@example.com" }),
    },
    {
      name: "graph.calendars",
      method: "GET",
      url: (u) => u.host === "graph.microsoft.com" && u.pathname === "/v1.0/me/calendars",
      handler: () => ({ value: calendars }),
    },
    {
      name: "graph.calendarView",
      method: "GET",
      url: new RegExp(`^${MG.replace(/\./g, "\\.")}/me/calendars/([^/]+)/calendarView`),
      handler: (req) => ({ value: state.view?.[req.params[0]] ?? [] }),
    },
    {
      name: "graph.events.create",
      method: "POST",
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/(?:calendars\/[^/]+\/)?events$/,
      handler: (req) => {
        const id = `AAMk-${randomUUID()}`;
        const body = req.body as { isOnlineMeeting?: boolean };
        return {
          ...(req.body as object),
          id,
          iCalUId: `ical-${id}`,
          webLink: `https://outlook.office365.com/owa/?itemid=${id}`,
          onlineMeeting: body?.isOnlineMeeting ? { joinUrl: "https://teams.microsoft.com/l/meetup-join/fake" } : null,
        };
      },
    },
    {
      name: "graph.events.update",
      method: "PATCH",
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/([^/?]+)/,
      handler: (req) => ({ ...(req.body as object), id: req.params[0] }),
    },
    {
      name: "graph.events.cancel",
      method: "POST",
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/([^/?]+)\/cancel/,
      handler: () => new Response(null, { status: 202 }),
    },
    {
      name: "graph.events.delete",
      method: "DELETE",
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/([^/?]+)/,
      handler: () => new Response(null, { status: 204 }),
    },
  ];
}

/** Zoom OAuth token plus users/me and meetings CRUD. */
export function zoomRoutes(token: OAuthTokenOptions = {}): MockRoute[] {
  let next = 81000000000;
  return [
    { name: "zoom.token", method: "POST", url: "https://zoom.us/oauth/token", handler: () => tokenResponse(token) },
    {
      name: "zoom.me",
      method: "GET",
      url: "https://api.zoom.us/v2/users/me",
      handler: () => ({ id: "zoom-user-1", email: "zoom@example.com", first_name: "Zoom", last_name: "User" }),
    },
    {
      name: "zoom.meetings.create",
      method: "POST",
      url: "https://api.zoom.us/v2/users/me/meetings",
      handler: (req) => {
        const id = next++;
        return {
          ...(req.body as object),
          id,
          join_url: `https://zoom.us/j/${id}?pwd=fake`,
          start_url: `https://zoom.us/s/${id}`,
          password: "123456",
          settings: { global_dial_in_numbers: [{ number: "+1 646 558 8656", country: "US", type: "toll" }] },
        };
      },
    },
    {
      name: "zoom.meetings.update",
      method: "PATCH",
      url: /^https:\/\/api\.zoom\.us\/v2\/meetings\/(\d+)/,
      handler: () => new Response(null, { status: 204 }),
    },
    {
      name: "zoom.meetings.delete",
      method: "DELETE",
      url: /^https:\/\/api\.zoom\.us\/v2\/meetings\/(\d+)/,
      handler: () => new Response(null, { status: 204 }),
    },
  ];
}

export type FakeSms = { to: string; from?: string; messagingServiceSid?: string; body: string; sid: string };

/** Twilio Messages API; every sent message is pushed to `sent`. */
export function twilioRoutes(sent: FakeSms[] = []): MockRoute[] {
  return [
    {
      name: "twilio.messages.create",
      method: "POST",
      url: /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json/,
      handler: (req) => {
        const form = (req.body ?? {}) as Record<string, string>;
        const sid = `SM${randomUUID().replace(/-/g, "")}`;
        sent.push({ to: form.To, from: form.From, messagingServiceSid: form.MessagingServiceSid, body: form.Body, sid });
        return mockResponse({ sid, status: "queued", num_segments: "1", to: form.To }, { status: 201 });
      },
    },
  ];
}

export type FakeCalendlyData = {
  user?: Record<string, unknown>;
  eventTypes?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  scheduledEvents?: Record<string, unknown>[];
  /** Page size for collection endpoints (pagination.next_page_token). */
  pageSize?: number;
};

/** Calendly v2 API (BR-17 importer): users/me, event_types, user_availability_schedules, scheduled_events. */
export function calendlyApiRoutes(data: FakeCalendlyData = {}): MockRoute[] {
  const base = "https://api.calendly.com";
  const user = data.user ?? {
    uri: `${base}/users/USER1`,
    name: "Julian Joseph",
    slug: "julianjoseph",
    email: "owner@example.com",
    timezone: "America/Los_Angeles",
    current_organization: `${base}/organizations/ORG1`,
  };
  const page = (items: Record<string, unknown>[], req: MockRequest) => {
    const size = data.pageSize ?? 100;
    const offset = Number(req.url.searchParams.get("page_token") ?? 0);
    const slice = items.slice(offset, offset + size);
    const nextOffset = offset + size;
    return {
      collection: slice,
      pagination: {
        count: slice.length,
        next_page_token: nextOffset < items.length ? String(nextOffset) : null,
        next_page: nextOffset < items.length ? `${req.url.origin}${req.url.pathname}?page_token=${nextOffset}` : null,
      },
    };
  };
  const auth = (req: MockRequest) =>
    req.headers.get("authorization")?.startsWith("Bearer ")
      ? null
      : mockResponse({ title: "Unauthenticated", message: "The access token is invalid" }, { status: 401 });
  return [
    { name: "calendly.me", method: "GET", url: `${base}/users/me`, handler: (req) => auth(req) ?? { resource: user } },
    { name: "calendly.event_types", method: "GET", url: `${base}/event_types`, handler: (req) => auth(req) ?? page(data.eventTypes ?? [], req) },
    {
      name: "calendly.schedules",
      method: "GET",
      url: `${base}/user_availability_schedules`,
      handler: (req) => auth(req) ?? { collection: data.schedules ?? [] },
    },
    {
      name: "calendly.scheduled_events",
      method: "GET",
      url: `${base}/scheduled_events`,
      handler: (req) => auth(req) ?? page(data.scheduledEvents ?? [], req),
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Fake Stripe SDK client (the subset the payments module uses) and REST routes for fetch-based clients.
// ---------------------------------------------------------------------------------------------------------------

export type FakeStripeSession = {
  id: string;
  object: "checkout.session";
  url: string;
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  amount_total: number;
  currency: string;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  payment_intent: string | null;
  expires_at: number;
};

export function createFakeStripe(opts: { webhookSecret?: string } = {}) {
  const sessions = new Map<string, FakeStripeSession>();
  const paymentIntents = new Map<string, Record<string, unknown>>();
  const refunds: Record<string, unknown>[] = [];
  const secret = opts.webhookSecret ?? "whsec_test";
  const sign = (payload: string, timestamp = Math.floor(Date.now() / 1000)) =>
    `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
  const stripe = {
    sessions,
    paymentIntentsStore: paymentIntents,
    refundsStore: refunds,
    checkout: {
      sessions: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          const id = `cs_test_${randomUUID().replace(/-/g, "")}`;
          const lineItems = (params.line_items as { price_data?: { unit_amount?: number; currency?: string } }[]) ?? [];
          const session: FakeStripeSession = {
            id,
            object: "checkout.session",
            url: `https://checkout.stripe.com/c/pay/${id}`,
            status: "open",
            payment_status: "unpaid",
            amount_total: lineItems[0]?.price_data?.unit_amount ?? 0,
            currency: lineItems[0]?.price_data?.currency ?? "usd",
            client_reference_id: (params.client_reference_id as string) ?? null,
            metadata: (params.metadata as Record<string, string>) ?? {},
            payment_intent: null,
            expires_at: Number(params.expires_at ?? Math.floor(Date.now() / 1000) + 1800),
          };
          sessions.set(id, session);
          return session;
        }),
        retrieve: vi.fn(async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error(`No such checkout.session: ${id}`), { type: "StripeInvalidRequestError" });
          return s;
        }),
        expire: vi.fn(async (id: string) => {
          const s = sessions.get(id);
          if (s) s.status = "expired";
          return s;
        }),
      },
    },
    paymentIntents: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const id = `pi_test_${randomUUID().replace(/-/g, "")}`;
        const pi = { id, object: "payment_intent", status: "requires_payment_method", client_secret: `${id}_secret_x`, ...params };
        paymentIntents.set(id, pi);
        return pi;
      }),
      retrieve: vi.fn(async (id: string) => paymentIntents.get(id) ?? null),
      cancel: vi.fn(async (id: string) => {
        const pi = paymentIntents.get(id);
        if (pi) pi.status = "canceled";
        return pi;
      }),
    },
    refunds: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const refund = { id: `re_test_${randomUUID().replace(/-/g, "")}`, object: "refund", status: "succeeded", ...params };
        refunds.push(refund);
        return refund;
      }),
    },
    webhooks: {
      /** Same contract as stripe.webhooks.constructEvent (throws on a bad signature). */
      constructEvent: vi.fn((payload: string | Buffer, header: string, whsec: string) => {
        const body = payload.toString();
        const t = /t=(\d+)/.exec(header)?.[1];
        const v1 = /v1=([a-f0-9]+)/.exec(header)?.[1];
        const expected = t ? createHmac("sha256", whsec).update(`${t}.${body}`).digest("hex") : "";
        if (!t || !v1 || v1 !== expected) throw Object.assign(new Error("No signatures found matching the expected signature"), { type: "StripeSignatureVerificationError" });
        return JSON.parse(body);
      }),
      generateTestHeaderString: ({ payload, timestamp }: { payload: string; timestamp?: number }) => sign(payload, timestamp),
    },
    /** Marks a session paid and returns a signed checkout.session.completed webhook (payload plus header). */
    completeSession(id: string) {
      const s = sessions.get(id);
      if (!s) throw new Error(`fake stripe: unknown session ${id}`);
      s.status = "complete";
      s.payment_status = "paid";
      s.payment_intent = `pi_test_${randomUUID().replace(/-/g, "")}`;
      const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type: "checkout.session.completed", data: { object: s } });
      return { payload, header: sign(payload) };
    },
  };
  return stripe;
}

/** Stripe REST endpoints for clients that use fetch (Stripe.createFetchHttpClient). */
export function stripeRoutes(stripe = createFakeStripe()): MockRoute[] {
  return [
    {
      name: "stripe.checkout.sessions.create",
      method: "POST",
      url: "https://api.stripe.com/v1/checkout/sessions",
      handler: (req) => stripe.checkout.sessions.create(req.body as Record<string, unknown>),
    },
    {
      name: "stripe.checkout.sessions.retrieve",
      method: "GET",
      url: /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/([^/?]+)/,
      handler: (req) => stripe.checkout.sessions.retrieve(req.params[0]),
    },
    {
      name: "stripe.refunds.create",
      method: "POST",
      url: "https://api.stripe.com/v1/refunds",
      handler: (req) => stripe.refunds.create(req.body as Record<string, unknown>),
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------------------------

export type FrozenTime = {
  /** Jump to an instant (stays frozen there). */
  set: (instant: Date | string | number) => void;
  /** Move the frozen clock forward (or back with a negative value). */
  advance: (ms: number) => void;
  now: () => Date;
  restore: () => void;
};

/**
 * Freezes Date (and therefore now() from src/lib/time/now.ts) at `instant`. Only Date is faked: timers, promises and
 * database drivers keep working. Call restore() in afterEach.
 */
export function freezeTime(instant: Date | string | number): FrozenTime {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  return {
    set: (i) => vi.setSystemTime(new Date(i)),
    advance: (ms) => vi.setSystemTime(new Date(Date.now() + ms)),
    now: () => new Date(),
    restore: () => vi.useRealTimers(),
  };
}
