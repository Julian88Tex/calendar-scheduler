// "Compare with my calendar" on the public booking page: a visitor connects their own Google Calendar for a while
// (OAuth intent compare_calendar: free/busy and the calendar list, no events), picks which of their calendars count,
// and the host's open times that clash with them read "Conflict". Their token stays sealed in their own browser for
// an hour at most (src/lib/compare/session.ts); busy times come back as bare ranges and nothing is stored.
// Loaded on demand (next/dynamic) so the booking page keeps its GEN-07 JavaScript budget; its copy lives here for the
// same reason.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import { COMPARE_API_PATH, COMPARE_MAX_CALENDARS, COMPARE_PARAM } from "@/lib/compare/constants";
import type { BusyRange } from "./lib/slots";

type Calendar = { id: string; name: string; color: string | null; primary: boolean; selected: boolean };
type Connection =
  | { status: "loading" }
  | { status: "disconnected"; expired?: boolean }
  | { status: "connected"; email: string; calendars: Calendar[] }
  | { status: "error" };

const COPY = {
  intro: "See which of these times work with your own Google Calendar.",
  privacy: "Only busy times are read, never what your events are. Nothing is saved, and the connection ends within an hour.",
  connect: "Connect Google Calendar",
  close: "Close",
  comparing: "Comparing with {email}",
  disconnect: "Disconnect",
  pick: "Calendars to compare",
  legend: "Times marked Conflict overlap events on your calendar.",
  loading: "Checking your calendar...",
  failed: "We couldn't connect to your Google Calendar. Try again.",
  expired: "Your calendar connection ended. Connect again to keep comparing.",
  loadError: "We couldn't load your calendar.",
  noneChosen: "Choose at least one calendar.",
  someFailed: "Some calendars couldn't be read.",
};

const STORE_KEY = "kairos:compareCalendars";

function storedChoice(email: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as { email?: string; ids?: unknown }) : null;
    return v && v.email === email && Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function storeChoice(email: string, ids: string[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ email, ids }));
  } catch {
    // Private windows and blocked storage: the choice just isn't remembered.
  }
}

/** UTC bounds generously covering a local month in any zone. */
function monthWindow(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString(), end: new Date(Date.UTC(y, m, 1) + 2 * 86_400_000).toISOString() };
}

/** The page to come back to after Google, with ?compare=1 so the panel reopens (and no stale OAuth error). */
function returnPath(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("oauth_error");
  u.searchParams.delete("provider");
  u.searchParams.set(COMPARE_PARAM, "1");
  return `${u.pathname}${u.search}`;
}

export type CompareBarProps = {
  /** The month on screen ("2026-10"). */
  month: string;
  /** The visitor's busy ranges for a month, or null when nothing is compared. */
  onBusy: (month: string, busy: BusyRange[] | null) => void;
  onClose: () => void;
};

export function CompareBar({ month, onBusy, onClose }: CompareBarProps) {
  const [conn, setConn] = useState<Connection>({ status: "loading" });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [done, setDone] = useState<{ key: string; state: "ok" | "error" | "partial" } | null>(null);
  const [oauthError] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).has("oauth_error") : false));

  useEffect(() => {
    let cancelled = false;
    fetch(COMPARE_API_PATH, { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { connected?: boolean; expired?: boolean; email?: string; calendars?: Calendar[] } | null;
        if (cancelled) return;
        if (!res.ok || !data) return setConn({ status: "error" });
        if (!data.connected || !data.email) return setConn({ status: "disconnected", expired: data.expired });
        const calendars = data.calendars ?? [];
        setConn({ status: "connected", email: data.email, calendars });
        const known = new Set(calendars.map((c) => c.id));
        const stored = storedChoice(data.email)?.filter((id) => known.has(id));
        setChosen(stored && stored.length ? stored : calendars.filter((c) => c.selected).map((c) => c.id));
      })
      .catch(() => {
        if (!cancelled) setConn({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ids = useMemo(() => (chosen ?? []).slice(0, COMPARE_MAX_CALENDARS), [chosen]);
  const key = `${month}|${ids.join("\n")}`;
  // The lookup of the month and calendars on screen: loading until its answer arrives.
  const busyState = done?.key === key ? done.state : "loading";
  useEffect(() => {
    if (conn.status !== "connected") return;
    if (!ids.length) {
      onBusy(month, null);
      return;
    }
    let cancelled = false;
    fetch(`${COMPARE_API_PATH}/busy`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ calendarIds: ids, ...monthWindow(month) }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { busy?: BusyRange[]; failed?: string[]; connected?: boolean } | null;
        if (cancelled) return;
        if (res.status === 401) {
          onBusy(month, null);
          setConn({ status: "disconnected", expired: true });
          return;
        }
        if (!res.ok || !data?.busy) {
          setDone({ key, state: "error" });
          return;
        }
        onBusy(month, data.busy);
        setDone({ key, state: data.failed?.length ? "partial" : "ok" });
      })
      .catch(() => {
        if (!cancelled) setDone({ key, state: "error" });
      });
    return () => {
      cancelled = true;
    };
    // ids is keyed by its contents; onBusy is the parent's setter wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.status, key]);

  const toggle = (id: string, on: boolean) => {
    if (conn.status !== "connected") return;
    const next = on ? [...(chosen ?? []), id] : (chosen ?? []).filter((x) => x !== id);
    setChosen(next);
    storeChoice(conn.email, next);
  };

  const disconnect = async () => {
    onBusy(month, null);
    setConn({ status: "disconnected" });
    await fetch(COMPARE_API_PATH, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
  };

  const connect = () => window.location.assign(oauthStartPath("google", { intent: "compare_calendar", next: returnPath() }));

  return (
    <section aria-label="Compare with your calendar" data-testid="compare-bar" className="mt-4 rounded-[var(--radius-card)] border border-line px-4 py-3 text-[14px] leading-5 text-public-text">
      {conn.status === "loading" && <p className="text-ink-2">{COPY.loading}</p>}
      {(conn.status === "disconnected" || conn.status === "error") && (
        <div className="flex flex-col gap-3">
          {(oauthError || conn.status === "error") && (
            <p role="alert" className="text-danger-text">
              {COPY.failed}
            </p>
          )}
          {conn.status === "disconnected" && conn.expired && !oauthError && <p role="status">{COPY.expired}</p>}
          <p>{COPY.intro}</p>
          <p className="text-[13px] text-ink-2">{COPY.privacy}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" size="sm" leftIcon={<ProviderLogo provider="google" size={16} />} onClick={connect} data-testid="compare-connect">
              {COPY.connect}
            </Button>
            <button type="button" onClick={onClose} className="text-[14px] font-semibold text-brand-strong hover:underline">
              {COPY.close}
            </button>
          </div>
        </div>
      )}
      {conn.status === "connected" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="font-semibold break-all" data-testid="compare-email">
              {COPY.comparing.replace("{email}", conn.email)}
            </p>
            <button type="button" onClick={() => void disconnect()} className="text-[14px] font-semibold text-brand-strong hover:underline" data-testid="compare-disconnect">
              {COPY.disconnect}
            </button>
          </div>
          {conn.calendars.length > 1 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] text-ink-2">{COPY.pick}</legend>
              {conn.calendars.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={ids.includes(c.id)}
                  disabled={!ids.includes(c.id) && ids.length >= COMPARE_MAX_CALENDARS}
                  onCheckedChange={(on) => toggle(c.id, on)}
                  label={
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-ink-2" style={c.color ? { backgroundColor: c.color } : undefined} />
                      <span className="truncate">{c.name}</span>
                    </span>
                  }
                />
              ))}
            </fieldset>
          )}
          <p className="text-[12px] text-ink-2" aria-live="polite" data-testid="compare-status">
            {!ids.length
              ? COPY.noneChosen
              : busyState === "loading"
                ? COPY.loading
                : busyState === "error"
                  ? COPY.loadError
                  : busyState === "partial"
                    ? `${COPY.someFailed} ${COPY.legend}`
                    : COPY.legend}
          </p>
        </div>
      )}
    </section>
  );
}
