// Month slots loader of the booking calendar (SPEC BK-04 "fetches a whole month of slots per request in the invitee
// zone and prefetches the next month", BK-31). One request per (target, zone, duration, month, troubleshoot), kept for
// the page's lifetime; failed requests can be retried. Client only.
//
// Months are also kept in sessionStorage for a few minutes, so a refresh shows the last known days at once while the
// fresh request runs (stale while revalidate) instead of an empty calendar with a spinner.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { availableDatesOf, slotsKey, slotsUrl, type MonthSlots, type SlotsRequest } from "./lib/slots";

type Result = { data?: MonthSlots; error?: boolean };

export type MonthSlotsState = {
  status: "idle" | "loading" | "ready" | "error";
  data: MonthSlots | null;
  reload: () => void;
  prefetch: (r: SlotsRequest) => void;
  /** Drops every cached month and reloads the current one (after a slot was taken). */
  invalidate: () => void;
};

const CACHE_PREFIX = "kairos.slots:";
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCached(key: string): MonthSlots | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: MonthSlots };
    if (Date.now() - at < CACHE_TTL_MS) return data;
    window.sessionStorage.removeItem(CACHE_PREFIX + key);
    return null;
  } catch {
    return null;
  }
}

function writeCached(key: string, data: MonthSlots | null): void {
  try {
    if (data) window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
    else window.sessionStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // Storage full or blocked: the cache is only a speedup.
  }
}

function clearCached(): void {
  try {
    for (const k of Object.keys(window.sessionStorage)) if (k.startsWith(CACHE_PREFIX)) window.sessionStorage.removeItem(k);
  } catch {
    // Ignore, as above.
  }
}

/** Cacheable: troubleshoot answers carry the host's calendar details, so they never go to storage. */
const cacheable = (r: SlotsRequest) => !r.troubleshoot;

// False during server rendering and hydration, true after: storage is read only once hydrated, so the server and the
// first client render agree (an event with a locked time zone has a request on the server already).
const noSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

async function fetchMonth(r: SlotsRequest): Promise<MonthSlots> {
  const res = await fetch(slotsUrl(r), { headers: { accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`slots ${res.status}`);
  return (await res.json()) as MonthSlots;
}

export function useMonthSlots(req: SlotsRequest | null, onLoad?: (r: SlotsRequest, data: MonthSlots) => void): MonthSlotsState {
  const [results, setResults] = useState<Record<string, Result>>({});
  const inflight = useRef(new Map<string, number>());
  const generation = useRef(0);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  const load = useCallback((r: SlotsRequest, force = false) => {
    const key = slotsKey(r);
    if (!force && inflight.current.has(key)) return;
    const gen = generation.current;
    inflight.current.set(key, gen);
    fetchMonth(r).then(
      (data) => {
        if (generation.current !== gen) return;
        if (cacheable(r)) writeCached(key, data);
        setResults((prev) => ({ ...prev, [key]: { data } }));
        onLoadRef.current?.(r, data);
      },
      () => {
        if (generation.current !== gen) return;
        inflight.current.delete(key);
        setResults((prev) => ({ ...prev, [key]: { error: true } }));
      },
    );
  }, []);

  const key = req ? slotsKey(req) : null;
  useEffect(() => {
    if (req) load(req);
    // `key` captures every field of req.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  const entry = key ? results[key] : undefined;
  // While the request runs, a month cached by an earlier page load is shown. A first request (which may jump to the
  // first month with times once answered) skips an empty cached month, so "No times" does not flash before the jump.
  const hydrated = useHydrated();
  const cached = useMemo(() => {
    if (!hydrated || !req || !key || entry || !cacheable(req)) return null;
    const hit = readCached(key);
    return hit && req.first && availableDatesOf(hit, req.month).length === 0 ? null : hit;
    // `key` captures every field of req.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key, entry]);
  const data = entry?.data ?? cached;
  const status: MonthSlotsState["status"] = !req ? "idle" : data ? "ready" : entry?.error ? "error" : "loading";
  return {
    status,
    data,
    reload: () => {
      if (!req || !key) return;
      setResults((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      writeCached(key, null);
      load(req, true);
    },
    prefetch: (r) => load(r),
    invalidate: () => {
      generation.current += 1;
      inflight.current.clear();
      clearCached();
      setResults({});
      if (req) load(req, true);
    },
  };
}
