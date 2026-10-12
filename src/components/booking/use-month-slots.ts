// Month slots loader of the booking calendar (SPEC BK-04 "fetches a whole month of slots per request in the invitee
// zone and prefetches the next month", BK-31). One request per (target, zone, duration, month, troubleshoot), kept for
// the page's lifetime; failed requests can be retried. Client only.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { slotsKey, slotsUrl, type MonthSlots, type SlotsRequest } from "./lib/slots";

type Result = { data?: MonthSlots; error?: boolean };

export type MonthSlotsState = {
  status: "idle" | "loading" | "ready" | "error";
  data: MonthSlots | null;
  reload: () => void;
  prefetch: (r: SlotsRequest) => void;
  /** Drops every cached month and reloads the current one (after a slot was taken). */
  invalidate: () => void;
};

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
  const status: MonthSlotsState["status"] = !req ? "idle" : entry?.data ? "ready" : entry?.error ? "error" : "loading";
  return {
    status,
    data: entry?.data ?? null,
    reload: () => {
      if (!req || !key) return;
      setResults((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      load(req, true);
    },
    prefetch: (r) => load(r),
    invalidate: () => {
      generation.current += 1;
      inflight.current.clear();
      setResults({});
      if (req) load(req, true);
    },
  };
}
