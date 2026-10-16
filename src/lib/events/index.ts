// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain events public API (ARCHITECTURE section 12.1): the event types, publishEvent (outbox pattern: call it in the
// transaction of the state change) and eventJobPattern (the runner filter for after()). The subscriber registry and
// the dispatcher are loaded lazily (never from here) so module subscriber files can import this file without cycles.
export { EVENT_JOB_PRIORITY, eventJobPattern, publishEvent, type EventJobPayload } from "./publish";
export * from "./types";
