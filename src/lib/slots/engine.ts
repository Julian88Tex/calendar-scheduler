// computeSlots: the pure availability pipeline (SPEC SCH-01 to SCH-24; ARCHITECTURE section 7.3).
//
//   1. booking window (window.ts)                     5a. PAST / TOOSOON / RANGE
//   2. host anchor and containment blocks (schedule)  5b. group seats: join an existing slot or GROUP when full
//   3. combined blocks per pooling (blocks.ts)        5c. event type limits (DAILY_MAX, WEEKLY_MAX, MONTHLY_MAX)
//   4. candidate starts (candidates.ts)               5d. per host: schedule, NOCAL, busy with buffers, MEETING_LIMIT
//                                                     5e. pooling: HOST, ROUNDROBIN, UNFAIR    5f. emit the slot
//
// Busy rule: a candidate [s, e) conflicts with a busy interval when [s - bufferBefore, e + bufferAfter) overlaps the
// interval's blocking range (app meetings arrive already expanded by their own stored buffers, so buffers stack;
// calendar events and holds are unbuffered). Ignored: the meetings in query.ignoreMeetingIds (reschedule, SCH-24),
// the group slot being joined (SCH-14), holds in query.ignoreReservationKeys, and calendar events or meetings whose
// title matches a free/busy exception unless they are full group slots (SCH-13; holds are never exempt).
// Troubleshoot mode returns a diagnostic for every candidate (plus HOLIDAY and DURATION context entries, and with
// query.diagnoseOutsideHours the rest of each day flagged outsideHours); its BUFFER rule compares the candidate's core
// with the blocker's core (SCH-21). Blockers carry their code, the named event's own times and the buffer side, and
// limit entries name the full periods, so the Troubleshoot view can explain every time. Deterministic: never reads
// the clock.
import { combineBlocks, findContaining, fitsInside } from "./blocks";
import { BusyIndex, isIgnoredByFreeBusyRules, splitAtLocalMidnights } from "./busy";
import { dayGridStarts, gridStarts, mergeCandidates, shortBlockStarts, spotCandidates, type Candidate } from "./candidates";
import {
  countByPeriod,
  eventTypeLimitCodes,
  hasLimits,
  periodKeysOf,
  reachedPeriods,
  type Period,
  type PeriodCounts,
} from "./limits";
import { decidePooling, groupHosts } from "./pooling";
import { sortReasons } from "./reasons";
import { buildHostBlocks, type HostBlocks } from "./schedule";
import type {
  Blocker,
  BusyInterval,
  CandidateDiagnostic,
  EventTypeRules,
  HostInput,
  Interval,
  Millis,
  ReasonCode,
  Slot,
  SlotEngineInput,
  SlotEngineResult,
} from "./types";
import { bookingWindow, windowReasons } from "./window";
import { DAY_MS, MINUTE_MS, zoneClock, type ZoneClock } from "./zone";

type GroupSlot = EventTypeRules["groupSlots"][number];

/** The longest span of candidate starts one computeSlots call evaluates (requests are at most 62 days, SCH-05). */
export const MAX_QUERY_DAYS = 400;

type HostState = {
  host: HostInput;
  blocks: HostBlocks | null;
  index: BusyIndex;
  limitClock: ZoneClock | null;
  limitCounts: PeriodCounts | null;
  weekStart: 0 | 1;
};

type HostEval = { available: boolean; reasons: ReasonCode[]; blockers: Blocker[]; limitPeriods?: Period[]; outsideHours?: boolean };

const clampInt = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
};

function blockerOf(b: BusyInterval, code: ReasonCode, s: Millis): Blocker {
  const out: Blocker = { source: b.source, start: b.start, end: b.end, code };
  if (b.title !== undefined) out.title = b.title;
  if (b.meetingId !== undefined) out.meetingId = b.meetingId;
  if (b.calendarId !== undefined) out.calendarId = b.calendarId;
  if (b.eventTypeId !== undefined) out.eventTypeId = b.eventTypeId;
  if (b.core) out.core = { start: b.core.start, end: b.core.end };
  if (code === "BUFFER") out.bufferSide = (b.core ?? b).end <= s ? "before" : "after";
  return out;
}

/** Reason code of one blocker for candidate [s, e) (SCH-21 BUFFER rule: core versus core). */
function classify(b: BusyInterval, s: Millis, e: Millis, eventTypeId: string): ReasonCode {
  const core = b.core ?? b;
  if (!(core.start < e && core.end > s)) return "BUFFER";
  if (b.source === "calendar") return "CALENDAR";
  if (b.source === "reserved") return "RESERVED";
  return b.eventTypeId !== undefined && b.eventTypeId === eventTypeId ? "EVENT" : "OVERLAP";
}

export function computeSlots(input: SlotEngineInput): SlotEngineResult {
  const { rules, query } = input;
  if (!Number.isFinite(query.now) || !Number.isFinite(query.rangeStart) || !Number.isFinite(query.rangeEnd)) {
    throw new Error("computeSlots: query.now, rangeStart and rangeEnd must be finite epoch milliseconds");
  }
  const troubleshoot = query.troubleshoot === true;
  const groups = groupHosts(rules, input.hosts ?? []);
  const window = bookingWindow({ rules, hosts: groups.hosts, now: query.now });
  const empty = (): SlotEngineResult => (troubleshoot ? { slots: [], diagnostics: [], windowEnd: window.end } : { slots: [], windowEnd: window.end });
  if (!(query.rangeEnd > query.rangeStart)) return empty();

  const spotsMode = Array.isArray(rules.spots);
  const durationMs = clampInt(rules.durationMinutes, 1, 1440 * 14, 30) * MINUTE_MS;
  const incrementMinutes = clampInt(rules.incrementMinutes, 1, 1440, 30);
  const beforeMs = clampInt(rules.bufferBeforeMinutes, 0, 1440, 0) * MINUTE_MS;
  const afterMs = clampInt(rules.bufferAfterMinutes, 0, 1440, 0) * MINUTE_MS;
  const isGroup = rules.kind === "group";
  const seats = clampInt(rules.seats, 1, 1_000_000, 1);
  const rangeClock = zoneClock(rules.rangeZone);
  const ignoreLimits = query.ignoreLimits === true;
  const ignoreMeetings = new Set(query.ignoreMeetingIds ?? []);
  const ignoreReservations = new Set(query.ignoreReservationKeys ?? []);
  const exceptions = rules.freeBusyExceptions ?? [];

  // Evaluation range. Outside troubleshooting nothing before the notice cutoff or outside the window can be offered,
  // so the range is clamped first (the grid does not depend on it: it is anchored on the blocks).
  let from = query.rangeStart;
  let to = query.rangeEnd;
  if (!troubleshoot) {
    from = Math.max(from, window.now, window.earliest, window.start ?? -Infinity);
    if (window.end !== null) to = Math.min(to, window.end);
    if (to <= from) return empty();
  }
  // Defense in depth against unbounded ranges (callers ask for at most 62 days, SCH-05): never evaluate more than
  // MAX_QUERY_DAYS of starts in one call, so a bad API range cannot make the engine allocate millions of candidates.
  to = Math.min(to, from + MAX_QUERY_DAYS * DAY_MS);

  // Step 2: host blocks (skipped in spots mode).
  const marginDays = 1 + Math.ceil(durationMs / DAY_MS);
  const states = new Map<string, HostState>();
  const staticIgnored = (b: BusyInterval): boolean => {
    if (b.meetingId !== undefined && ignoreMeetings.has(b.meetingId)) return true;
    if (b.source === "reserved" && b.reservationKey !== undefined && ignoreReservations.has(b.reservationKey)) return true;
    return isIgnoredByFreeBusyRules(b, exceptions);
  };
  for (const h of groups.hosts) {
    const blocks = !spotsMode && h.schedule ? buildHostBlocks(h.schedule, from, to, marginDays) : null;
    const busy = (h.busy ?? []).filter((b) => b && !staticIgnored(b));
    const useHostLimits = !ignoreLimits && hasLimits(h.hostLimits);
    const weekStart = h.weekStart === 1 || h.weekStart === 0 ? h.weekStart : rules.weekStart === 1 ? 1 : 0;
    const limitZone = h.hostLimitZone || rules.rangeZone;
    states.set(h.userId, {
      host: h,
      blocks,
      index: new BusyIndex(busy),
      limitClock: useHostLimits ? zoneClock(limitZone) : null,
      limitCounts: useHostLimits ? countByPeriod(h.hostMeetingStarts, limitZone, weekStart, ignoreMeetings) : null,
      weekStart,
    });
  }

  // Steps 3 and 4: combined blocks and candidates.
  const candidateLists: Candidate[][] = [];
  let wouldBe: Interval[] = [];
  if (spotsMode) {
    candidateLists.push(spotCandidates(rules.spots ?? [], from, to));
  } else {
    const combined = combineBlocks(groups, (id) => states.get(id)?.blocks ?? undefined, rules.rangeZone);
    const grid = { durationMs, incrementMinutes, alignment: rules.alignment, rangeZone: rules.rangeZone, from, to };
    candidateLists.push(
      gridStarts(combined.anchors, combined.containment, grid).map((s) => ({ start: s, end: s + durationMs, origin: "grid" as const })),
    );
    if (troubleshoot) {
      if (query.diagnoseOutsideHours === true) {
        // Starts outside the combined hours (what the schedules would offer without holidays: holiday times have
        // their own HOLIDAY entries). A start inside the hours whose meeting does not fit is a DURATION entry.
        const anyHoliday = [...states.values()].some((st) => (st.blocks?.holidayAnchors.length ?? 0) > 0);
        const hours = anyHoliday
          ? combineBlocks(
              groups,
              (id) => {
                const b = states.get(id)?.blocks;
                return b ? { ...b, anchors: [], containment: b.holidayContainment } : undefined;
              },
              rules.rangeZone,
            ).containment
          : combined.containment;
        wouldBe = hours;
        candidateLists.push(
          dayGridStarts(rules.rangeZone, incrementMinutes, from, to)
            .filter((s) => !fitsInside(hours, s, s + durationMs))
            .map((s) => ({ start: s, end: s + durationMs, origin: "outside" as const })),
        );
      }
      candidateLists.push(
        shortBlockStarts(combined.containment, durationMs, from, to).map((s) => ({
          start: s,
          end: s + durationMs,
          origin: "duration" as const,
        })),
      );
      for (const st of states.values()) {
        const b = st.blocks;
        if (!b || b.holidayAnchors.length === 0) continue;
        const anchors = splitAtLocalMidnights(b.holidayAnchors, rules.rangeZone);
        candidateLists.push(
          gridStarts(anchors, b.holidayContainment, grid).map((s) => ({ start: s, end: s + durationMs, origin: "holiday" as const })),
        );
      }
    }
  }
  const groupSlotByKey = new Map<string, GroupSlot>();
  if (isGroup && !spotsMode) {
    const joinable: Candidate[] = [];
    for (const g of rules.groupSlots ?? []) {
      if (!g || !Number.isFinite(g.start) || !Number.isFinite(g.end)) continue;
      const key = `${g.start}:${g.end}`;
      const existing = groupSlotByKey.get(key);
      if (!existing || (existing.meetingId == null && g.meetingId != null)) groupSlotByKey.set(key, g);
      if (g.meetingId != null && g.end - g.start === durationMs && g.start >= from && g.start < to) {
        joinable.push({ start: g.start, end: g.end, origin: "group" });
      }
    }
    candidateLists.push(joinable);
  }
  // Outside-hours entries only fill times that have no other candidate start.
  const merged = mergeCandidates(candidateLists);
  const taken = new Set(merged.filter((c) => c.origin !== "outside").map((c) => c.start));
  const candidates = merged.filter((c) => c.origin !== "outside" || !taken.has(c.start));

  // Event type limit counts (whole periods, reschedule exclusion).
  const weekStart: 0 | 1 = rules.weekStart === 1 ? 1 : 0;
  const etCounts = !ignoreLimits && hasLimits(rules.limits)
    ? countByPeriod(rules.eventTypeMeetingStarts, rules.rangeZone, weekStart, ignoreMeetings)
    : null;

  const evalHost = (st: HostState, s: Millis, e: Millis, joinId: string | null, full: boolean): HostEval => {
    const h = st.host;
    const reasons: ReasonCode[] = [];
    let blockers: Blocker[] = [];
    let inSchedule = true;
    let outsideHours = false;
    if (!spotsMode) {
      const b = st.blocks;
      inSchedule = !!b && fitsInside(b.containment, s, e);
      if (!inSchedule && full) {
        if (b && b.holidayAnchors.length > 0 && fitsInside(b.holidayContainment, s, e)) reasons.push("HOLIDAY");
        else if (b && findContaining(b.containment, s) >= 0) reasons.push("DURATION");
        else outsideHours = true;
      }
    }
    const nocal = h.calendarStatus === "nocal";
    if (nocal) reasons.push("NOCAL");
    const ws = s - beforeMs;
    const we = e + afterMs;
    const skipJoined = joinId !== null ? (b: BusyInterval) => b.meetingId === joinId : undefined;
    if (!full) {
      if (!inSchedule || nocal) return { available: false, reasons, blockers };
      const busy = skipJoined ? st.index.anyOverlapExcept(ws, we, skipJoined) : st.index.anyOverlap(ws, we);
      if (busy) return { available: false, reasons, blockers };
      if (st.limitCounts && joinId === null) {
        const keys = periodKeysOf(s, st.limitClock!, st.weekStart);
        if (reachedPeriods(keys, st.limitCounts, h.hostLimits).length > 0) return { available: false, reasons, blockers };
      }
      return { available: true, reasons, blockers };
    }
    const hits = st.index.overlapping(ws, we, skipJoined);
    blockers = hits.map((b) => {
      const code = classify(b, s, e, rules.eventTypeId);
      reasons.push(code);
      return blockerOf(b, code, s);
    });
    let limitPeriods: Period[] | undefined;
    if (st.limitCounts && joinId === null) {
      const keys = periodKeysOf(s, st.limitClock!, st.weekStart);
      const reached = reachedPeriods(keys, st.limitCounts, h.hostLimits);
      if (reached.length > 0) {
        reasons.push("MEETING_LIMIT");
        limitPeriods = reached;
      }
    }
    const sorted = sortReasons(reasons);
    const out: HostEval = { available: inSchedule && sorted.length === 0, reasons: sorted, blockers };
    if (limitPeriods) out.limitPeriods = limitPeriods;
    if (outsideHours) out.outsideHours = true;
    return out;
  };

  const singleHost = groups.pooling === null && groups.required.length === 1 && groups.pools.length === 0;
  const slots: Slot[] = [];
  const diagnostics: CandidateDiagnostic[] = [];

  for (const c of candidates) {
    const s = c.start;
    const e = c.end;
    const real = c.origin === "grid" || c.origin === "group" || c.origin === "spot";
    const codes: ReasonCode[] = troubleshoot ? windowReasons(s, window) : [];
    if (c.origin === "duration") codes.push("DURATION");
    if (c.origin === "holiday") codes.push("HOLIDAY");
    const outsideHours = c.origin === "outside" && findContaining(wouldBe, s) < 0;
    if (c.origin === "outside" && !outsideHours) codes.push("DURATION");

    // 5b. Group seats.
    const slot = isGroup ? groupSlotByKey.get(`${s}:${e}`) : undefined;
    const joinId = slot?.meetingId ?? null;
    if (slot && slot.remaining <= 0) {
      if (!troubleshoot) continue;
      codes.push("GROUP");
    }

    // 5c. Event type limits (a join adds no meeting, so limits are not re-applied).
    let limitPeriods: Period[] = [];
    if (etCounts && joinId === null) {
      limitPeriods = reachedPeriods(periodKeysOf(s, rangeClock, weekStart), etCounts, rules.limits);
      if (limitPeriods.length > 0) {
        if (!troubleshoot) continue;
        codes.push(...eventTypeLimitCodes(limitPeriods));
      }
    }

    // 5d and 5e. Hosts and pooling.
    const evals = new Map<string, HostEval>();
    for (const [id, st] of states) {
      const ev = evalHost(st, s, e, joinId, troubleshoot);
      evals.set(id, ev);
    }
    const decision = decidePooling(groups, (id) => evals.get(id)?.available === true);
    const available = real && codes.length === 0 && decision.available;

    if (available) {
      const out: Slot = {
        start: s,
        end: e,
        inviteesRemaining: isGroup ? (slot ? slot.remaining : seats) : decision.capacity,
        eligibleHostIds: decision.eligibleHostIds,
        eligibleByPool: decision.eligibleByPool,
      };
      if (slot?.meetingId) out.existingMeetingId = slot.meetingId;
      slots.push(out);
    }

    if (troubleshoot) {
      const reasons: ReasonCode[] = [...codes, ...decision.reasons];
      let singleOutside = false;
      if (singleHost) {
        const only = evals.get(groups.required[0]!.userId);
        if (only) reasons.push(...only.reasons);
        singleOutside = only?.outsideHours === true;
      }
      const hostsOut: CandidateDiagnostic["hosts"] = {};
      for (const [id, ev] of evals) {
        const entry: CandidateDiagnostic["hosts"][string] = { available: ev.available, reasons: ev.reasons, blockers: ev.blockers };
        if (ev.limitPeriods) entry.limitPeriods = ev.limitPeriods;
        if (ev.outsideHours) entry.outsideHours = true;
        hostsOut[id] = entry;
      }
      const diag: CandidateDiagnostic = { start: s, end: e, available, reasons: available ? [] : sortReasons(reasons), hosts: hostsOut };
      if (limitPeriods.length > 0) diag.limitPeriods = limitPeriods;
      if (outsideHours || (singleOutside && !available)) diag.outsideHours = true;
      diagnostics.push(diag);
    }
  }

  return troubleshoot ? { slots, diagnostics, windowEnd: window.end } : { slots, windowEnd: window.end };
}
