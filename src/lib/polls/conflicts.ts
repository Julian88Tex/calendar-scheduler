// Host calendar status of poll options (SPEC MP-16, MP-18, MP-28; research meeting-polls.md B6, B7.1). Server only.
//
// For every future option and every host (owner and co-hosts): an app meeting overlapping the option's own time
// ("Booked: {event}", red, blocks booking; buffers of other meetings never block, "You can book over buffers"), else an
// external calendar event ("Conflicts with '{title}'", amber, booking allowed), else another poll's or one-off's hold
// (a warning), else free. This poll's own holds and its own booked meeting (a reopened poll) never conflict. Titles
// follow GEN-08: only the viewer's own events carry titles (busy.getBusyForUsers), co-hosts show "Busy".
import "server-only";
import { getBusyForUsers } from "@/lib/booking";
import { log } from "@/lib/logger";
import type { BusyInterval } from "@/lib/slots/types";
import { pollHoldIntervals } from "./holds";
import { endOf, startOf, type OptionRow, type PollHostRow, type PollRow } from "./load";
import type { HostCalendarStatus } from "./types";

const DAY = 86_400_000;
const WINDOW_DAYS = 90;

export type BusyByUser = Record<string, BusyInterval[]>;

/** Busy intervals of the hosts over the options' range (windows of at most 90 days), without this poll's holds. */
export async function hostBusyForPoll(
  viewer: { userId: string; organizationId: string },
  poll: Pick<PollRow, "id" | "timezone">,
  hostIds: string[],
  options: readonly OptionRow[],
  now: Date,
): Promise<BusyByUser | null> {
  const future = options.filter((o) => startOf(o, poll.timezone) > now.getTime());
  if (!future.length || !hostIds.length) return {};
  const ranges = future.map((o) => ({ start: startOf(o, poll.timezone), end: endOf(o, poll.timezone) })).sort((a, b) => a.start - b.start);
  const windows: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = windows[windows.length - 1];
    if (last && r.end - last.start <= WINDOW_DAYS * DAY) last.end = Math.max(last.end, r.end);
    else windows.push({ ...r });
  }
  const out: BusyByUser = {};
  try {
    for (const w of windows) {
      const busy = await getBusyForUsers(viewer, hostIds, new Date(w.start), new Date(w.end));
      for (const [userId, list] of Object.entries(busy)) {
        // Poll holds come back below with their poll, so this poll's own holds can be left out.
        (out[userId] ??= []).push(...list.filter((b) => !(b.source === "reserved" && b.reservedKind === "poll")));
      }
      for (const h of await pollHoldIntervals(hostIds, new Date(w.start), new Date(w.end), { excludePollId: poll.id })) {
        (out[h.userId] ??= []).push({ start: h.start, end: h.end, source: "reserved", reservedKind: "poll", title: h.userId === viewer.userId ? h.title : null });
      }
    }
  } catch (e) {
    log.warn("polls.host_busy_failed", { pollId: poll.id, error: e });
    return null;
  }
  return out;
}

const RANK: Record<HostCalendarStatus["state"], number> = { unknown: 0, free: 0, hold: 1, conflict: 2, booked: 3 };

/** The status of one option for the hosts (worst wins: booked > conflict > hold > free). */
export function optionHostStatus(
  option: { start: number; end: number },
  busy: BusyByUser | null,
  hosts: readonly Pick<PollHostRow, "userId" | "name">[],
  ownMeetingId: string | null,
): HostCalendarStatus {
  if (!busy) return { state: "unknown" };
  let best: HostCalendarStatus = { state: "free" };
  for (const h of hosts) {
    for (const b of busy[h.userId] ?? []) {
      let status: HostCalendarStatus | null = null;
      if (b.source === "meeting") {
        if (ownMeetingId && b.meetingId === ownMeetingId) continue;
        const core = b.core ?? { start: b.start, end: b.end };
        if (core.start < option.end && option.start < core.end) status = { state: "booked", title: b.title ?? null, hostName: h.name, meetingId: b.meetingId ?? null };
      } else if (b.start < option.end && option.start < b.end) {
        status = b.source === "calendar" ? { state: "conflict", title: b.title ?? null, hostName: h.name } : { state: "hold", title: b.title ?? null, hostName: h.name };
      }
      if (status && RANK[status.state] > RANK[best.state]) best = status;
      if (best.state === "booked") return best;
    }
  }
  return best;
}

/** Statuses of every future option, plus the ids where a host is busy (ranking's hostFree = false). */
export function optionStatuses(
  poll: Pick<PollRow, "timezone" | "bookedScheduledEventId">,
  options: readonly OptionRow[],
  busy: BusyByUser | null,
  hosts: readonly Pick<PollHostRow, "userId" | "name">[],
  now: Date,
): { statuses: Map<string, HostCalendarStatus>; busyIds: Set<string> } {
  const statuses = new Map<string, HostCalendarStatus>();
  const busyIds = new Set<string>();
  for (const o of options) {
    const start = startOf(o, poll.timezone);
    if (start <= now.getTime()) {
      statuses.set(o.id, { state: "unknown" });
      continue;
    }
    const s = optionHostStatus({ start, end: endOf(o, poll.timezone) }, busy, hosts, poll.bookedScheduledEventId);
    statuses.set(o.id, s);
    if (s.state === "booked" || s.state === "conflict") busyIds.add(o.id);
  }
  return { statuses, busyIds };
}
