// OWNER: slot-engine. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Slot engine interfaces, verbatim from ARCHITECTURE section 7.2 (pure, no I/O). The functions declared at the end are
// implemented in src/lib/slots/index.ts by slot-engine: import computeSlots, selectHosts, reasonLabel and reasonHint
// from "@/lib/slots", never from this file (these are type-level declarations only).
export type Millis = number;                                   // epoch ms, UTC
export interface Interval { start: Millis; end: Millis }       // half-open [start, end)
export type MinuteRange = { start: number; end: number };      // local minutes 0..1440
export type WeeklyHours = [MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[], MinuteRange[]]; // 0 = Sunday

export interface ScheduleInput {
  timeZone: string;                                            // IANA
  weekly: WeeklyHours;
  overrides: Record<string, MinuteRange[]>;                    // "YYYY-MM-DD" -> intervals (empty array = unavailable that date)
  blockedDates: string[];                                      // holidays observed, "YYYY-MM-DD" in this schedule's zone (beat overrides)
}

export type BusySource = "calendar" | "meeting" | "reserved";
export interface BusyInterval extends Interval {               // start/end are the BLOCKING range (meetings: buffered range)
  source: BusySource;
  core?: Interval;                                             // meetings: the meeting itself without buffers (for BUFFER vs OVERLAP)
  title?: string | null;                                       // free/busy rule matching, troubleshoot detail
  meetingId?: string;                                          // source = meeting
  eventTypeId?: string;                                        // source = meeting
  isFullGroupSlot?: boolean;                                   // free/busy rules never ignore full group slots
  calendarId?: string;                                         // source = calendar
  reservedKind?: "one_off" | "poll" | "reservation";           // source = reserved (never buffered)
  reservationKey?: string;                                     // source = reserved, reservedKind = reservation: booking_reservations.id
}
export interface MeetingStart { start: Millis; meetingId: string }   // counts input; ignored ids are skipped

export interface PeriodLimits { day?: number | null; week?: number | null; month?: number | null }

export interface HostInput {
  userId: string;
  schedule: ScheduleInput | null;                              // null with spots (one-off/poll) = ignore working hours
  busy: BusyInterval[];                                        // all sources, any order, may overlap; all-day already expanded by caller
  calendarStatus: "ok" | "nocal";                              // nocal: caller decided host is unavailable (SCH-11) -> NOCAL
  hostLimits: PeriodLimits;                                    // SCH-09
  hostLimitZone: string;                                       // host default schedule zone
  hostMeetingStarts: MeetingStart[];                           // the host's active meetings (all event types, all sources) covering
                                                               // startOfWeek(startOfMonth(rangeStart)) .. endOfWeek(endOfMonth(rangeEnd)) in hostLimitZone
  priority: 1 | 2 | 3 | 4 | 5;                                 // round robin
  poolId: string | null;                                       // null = required host
  rr: { count: number; lastAssignedAt: Millis | null } | null; // round robin state for this event type + pool (caller excludes
                                                               // query.ignoreMeetingIds; lastAssignedAt = max(assigned_at))
  weekStart?: 0 | 1;                                           // additive: host limit week start (the host's setting); default
                                                               // rules.weekStart
}

export interface PoolInput { id: string; distribution: "availability" | "equal" }

export type DateRangeRule =
  | { type: "rolling"; days: number; mode: "calendar_days" | "weekdays" | "available_days" }
  | { type: "fixed"; startDate: string; endDate: string }      // inclusive local dates
  | { type: "unlimited" };

export interface EventTypeRules {
  eventTypeId: string;
  durationMinutes: number;                                     // chosen duration (SCH-18)
  incrementMinutes: number;
  alignment: "interval_start" | "hour";
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  dateRange: DateRangeRule;
  rangeZone: string;                                           // zone for date range and event-type limit periods (SCH-08)
  weekStart: 0 | 1;
  limits: PeriodLimits;                                        // event type limits
  eventTypeMeetingStarts: MeetingStart[];                      // this event type's active scheduled events (group slot counted once)
                                                               // covering whole weeks and months around the range in rangeZone
  kind: "solo" | "group";
  seats: number;                                               // 1 for solo
  groupSlots: { start: Millis; end: Millis; remaining: number; meetingId: string | null }[];   // remaining = slot limit - active
                                                               // invitees - pending seat holds (caller); one entry per active slot of
                                                               // the event type in range, plus entries with meetingId null for starts
                                                               // that only have pending holds (no meeting yet)
  pooling: null | "collective" | "round_robin" | "multi_pool";
  pools: PoolInput[];
  freeBusyExceptions: { mode: "includes" | "exact"; text: string }[];
  spots?: Interval[] | null;                                   // explicit offered windows (one-off): candidates = spot starts only
  organizerUserId?: string | null;                             // additive: event_types.organizer_user_id (selectHosts organizer)
}

export interface SlotQuery {
  rangeStart: Millis;                                          // inclusive candidate start lower bound
  rangeEnd: Millis;                                            // exclusive candidate start upper bound
  now: Millis;
  troubleshoot?: boolean;                                      // include diagnostics for every candidate
  ignoreMeetingIds?: string[];                                 // reschedule (SCH-24): skipped in busy, eventTypeMeetingStarts and
                                                               // hostMeetingStarts. Never set for a group invitee (the slot keeps its
                                                               // other invitees): the caller adds 1 to that slot's remaining instead
  ignoreReservationKeys?: string[];                            // own reservation (retrying payment, completing a hold)
  ignoreLimits?: boolean;                                      // one-off spots and poll bookings (SCH-09 enforcement by source)
  diagnoseOutsideHours?: boolean;                              // additive, troubleshoot only: also list the day's starts outside
                                                               // the (combined) working hours on a grid from local midnight of
                                                               // rules.rangeZone, flagged outsideHours (the Troubleshoot view)
}

export interface Slot {
  start: Millis;
  end: Millis;
  inviteesRemaining: number;                                   // group: seats left (existing slot) or seats; solo: 1 (RR: number of eligible hosts)
  eligibleHostIds: string[];                                   // hosts that could attend
  eligibleByPool: Record<string, string[]>;                    // poolId -> eligible host ids ("required" key for required hosts)
  existingMeetingId?: string;                                  // group slot already exists
}

export type ReasonCode =
  | "CALENDAR" | "NOCAL" | "DAILY_MAX" | "WEEKLY_MAX" | "MONTHLY_MAX" | "DURATION" | "RANGE" | "TOOSOON" | "EVENT"
  | "GROUP" | "OVERLAP" | "HOLIDAY" | "MEETING_LIMIT" | "HOST" | "ROUNDROBIN" | "UNFAIR" | "BUFFER" | "PAST" | "RESERVED";

export interface Blocker { source: BusySource; start: Millis; end: Millis; title?: string | null; meetingId?: string; calendarId?: string;
  code?: ReasonCode;                                           // additive: the code this blocker produced (CALENDAR, EVENT, OVERLAP,
                                                               // RESERVED or BUFFER)
  core?: Interval;                                             // additive: meetings: the meeting without its buffers (display)
  bufferSide?: "before" | "after";                             // additive: BUFFER only: the blocker lies before or after the candidate
  eventTypeId?: string;                                        // additive: source = meeting
}
export interface CandidateDiagnostic {
  start: Millis; end: Millis; available: boolean; reasons: ReasonCode[];
  hosts: Record<string, { available: boolean; reasons: ReasonCode[]; blockers: Blocker[];
    limitPeriods?: ("day" | "week" | "month")[];              // additive: MEETING_LIMIT: the host limit periods that are full
    outsideHours?: boolean;                                    // additive: the start is outside this host's own working hours
                                                               // (no code exists for it; a round robin union grid or an existing
                                                               // group slot can offer such a start)
  }>;
  limitPeriods?: ("day" | "week" | "month")[];                // additive: event type limit periods that are full (DAILY_MAX ...)
  outsideHours?: boolean;                                      // additive: query.diagnoseOutsideHours entries outside working hours,
                                                               // and a single host's existing group slot outside its hours
}

export interface SlotEngineInput { rules: EventTypeRules; hosts: HostInput[]; query: SlotQuery }
export interface SlotEngineResult {
  slots: Slot[];                                               // sorted by start
  diagnostics?: CandidateDiagnostic[];                         // only when troubleshoot
  windowEnd: Millis | null;                                    // end of the booking window (null = unlimited)
}

export declare function computeSlots(input: SlotEngineInput): SlotEngineResult;

export interface AssignmentResult {
  hostIds: string[];                                           // all hosts of the meeting (required + one per pool)
  organizerId: string;
  byPool: Record<string, { userId: string; reason: "priority" | "least_recent" | "random" | "equal" }>;
}
export declare function selectHosts(input: { rules: EventTypeRules; hosts: HostInput[]; slot: Slot; random?: () => number;
  preferHostIds?: string[] /* reschedule same_hosts */; }): AssignmentResult | null;
export declare function reasonLabel(code: ReasonCode): string;          // "DAILY MAX", "MEETING LIMIT", ...
export declare function reasonHint(code: ReasonCode): { meaning: string; fix: string };
