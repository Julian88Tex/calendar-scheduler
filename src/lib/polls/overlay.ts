// Busy overlay of the creation grid (SPEC MP-02; research meeting-polls.md B3.1): busy blocks of the requester and the
// chosen co-hosts (same organization only; booking.getBusyForUsers enforces it and keeps titles for the requester's own
// events only, GEN-08), app meetings with their buffers, other polls' holds ("Reserved: {poll title}") and the
// requester's working hours (default schedule) for the shading. The poll being edited never shows its own holds.
// Server only.
import "server-only";
import { getAvailabilityDefaults } from "./overlay-schedule";
import type { ActorCtx } from "@/lib/authz";
import { getBusyForUsers } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import { MAX_POLL_COHOSTS } from "./constants";
import { pollHoldIntervals } from "./holds";

const DAY = 86_400_000;

export type OverlayBlock = {
  start: string;
  end: string;
  kind: "calendar" | "meeting" | "hold" | "reservation";
  /** Meetings: the meeting without its buffers. */
  core: { start: string; end: string } | null;
  /** The requester's own events only. */
  title: string | null;
};

export type PollGridOverlay = {
  busy: Record<string, OverlayBlock[]>;
  /** The requester's working hours (instants) for the grid shading. */
  workingHours: { start: string; end: string }[];
  scheduleTimeZone: string | null;
};

export async function getPollGridOverlay(
  actor: ActorCtx,
  p: { start: Date; end: Date; hostIds?: string[]; pollId?: string | null },
): Promise<PollGridOverlay> {
  if (!(p.end.getTime() > p.start.getTime())) throw new AppError("validation", "Invalid range.");
  if (p.end.getTime() - p.start.getTime() > 62 * DAY) throw new AppError("validation", "The range is too long.");
  const ids = [...new Set([actor.user.id, ...(p.hostIds ?? [])])];
  if (ids.length > MAX_POLL_COHOSTS + 1) throw new AppError("validation", "Too many hosts.");
  const raw = await getBusyForUsers({ userId: actor.user.id, organizationId: actor.orgId }, ids, p.start, p.end);
  const holds = await pollHoldIntervals(ids, p.start, p.end, { excludePollId: p.pollId ?? null });
  const busy: PollGridOverlay["busy"] = {};
  for (const id of ids) {
    const list: OverlayBlock[] = [];
    for (const b of raw[id] ?? []) {
      if (b.source === "reserved" && b.reservedKind === "poll") continue; // re-added below without this poll
      list.push({
        start: new Date(b.start).toISOString(),
        end: new Date(b.end).toISOString(),
        kind: b.source === "meeting" ? "meeting" : b.source === "calendar" ? "calendar" : b.reservedKind === "reservation" ? "reservation" : "hold",
        core: b.core ? { start: new Date(b.core.start).toISOString(), end: new Date(b.core.end).toISOString() } : null,
        title: b.title ?? null,
      });
    }
    for (const h of holds) {
      if (h.userId !== id) continue;
      list.push({ start: new Date(h.start).toISOString(), end: new Date(h.end).toISOString(), kind: "hold", core: null, title: id === actor.user.id ? (h.title ?? null) : null });
    }
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    busy[id] = list;
  }
  const schedule = await getAvailabilityDefaults(actor.user.id, p.start, p.end);
  return { busy, workingHours: schedule.workingHours, scheduleTimeZone: schedule.timeZone };
}
