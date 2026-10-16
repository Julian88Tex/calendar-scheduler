// Busy overlay of the creation grid (SPEC MP-02): loads polls-core's getPollGridOverlay through pollGridOverlayAction
// for the visible range and the chosen hosts (the requester's events with titles, co-hosts' without, app meetings with
// buffers, other polls' holds, working hours), cached per range so going back and forth between weeks is instant.
// Client hook.
"use client";

import { useEffect, useRef, useState } from "react";
import { pollGridOverlayAction } from "@/lib/polls/actions";
import type { PollGridOverlay } from "@/lib/polls/server";
import type { GridBusy } from "./week-grid";

export type OverlayState = { busy: GridBusy[]; working: { start: number; end: number }[]; loading: boolean; error: boolean };

const EMPTY: OverlayState = { busy: [], working: [], loading: false, error: false };

/** Flattens the overlay of every host into grid blocks (the requester's own first). */
export function toGridBusy(overlay: PollGridOverlay, requesterId: string): GridBusy[] {
  const out: GridBusy[] = [];
  for (const [userId, blocks] of Object.entries(overlay.busy)) {
    for (const b of blocks) {
      out.push({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
        kind: b.kind,
        title: userId === requesterId ? b.title : null,
        owner: userId === requesterId ? "me" : "cohost",
        core: b.core ? { start: new Date(b.core.start).getTime(), end: new Date(b.core.end).getTime() } : null,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function useGridOverlay(p: { start: number; end: number; hostIds: string[]; pollId: string | null; requesterId: string; enabled: boolean }): OverlayState {
  const cache = useRef(new Map<string, OverlayState>());
  const key = `${p.start}|${p.end}|${[...p.hostIds].sort().join(",")}`;
  const [state, setState] = useState<{ key: string; value: OverlayState }>({ key: "", value: EMPTY });
  const hostKey = [...p.hostIds].sort().join(",");

  useEffect(() => {
    if (!p.enabled) return;
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, value: cached });
      return;
    }
    let live = true;
    setState((s) => ({ key, value: { ...(s.key === key ? s.value : EMPTY), loading: true, error: false } }));
    void pollGridOverlayAction({
      start: new Date(p.start).toISOString(),
      end: new Date(p.end).toISOString(),
      hostIds: hostKey ? hostKey.split(",") : [],
      pollId: p.pollId,
    })
      .then((res) => {
        if (!live) return;
        if (!res.ok) {
          setState({ key, value: { ...EMPTY, error: true } });
          return;
        }
        const value: OverlayState = {
          busy: toGridBusy(res.data, p.requesterId),
          working: res.data.workingHours.map((w) => ({ start: new Date(w.start).getTime(), end: new Date(w.end).getTime() })),
          loading: false,
          error: false,
        };
        cache.current.set(key, value);
        setState({ key, value });
      })
      .catch(() => {
        if (live) setState({ key, value: { ...EMPTY, error: true } });
      });
    return () => {
      live = false;
    };
  }, [key, p.enabled, p.start, p.end, hostKey, p.pollId, p.requesterId]);

  return state.key === key ? state.value : { ...EMPTY, loading: p.enabled };
}
