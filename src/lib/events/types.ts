// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain event types (ARCHITECTURE section 12.1). The complete list: modules may not add types without a schema-style
// request (docs/schema-requests/<module-id>.md). Type-only module: safe to import from anywhere, including client code.
import type { JobContext } from "../jobs/types";

export type DomainEventMap = {
  "booking.created": { scheduledEventId: string; inviteeId: string; source: string };
  "booking.canceled": {
    scheduledEventId: string;
    inviteeId: string;
    cancelerType: "host" | "invitee" | "system";
    reason: string | null;
    meetingCanceled: boolean;
  };
  "booking.rescheduled": {
    oldInviteeId: string;
    newInviteeId: string;
    oldScheduledEventId: string;
    newScheduledEventId: string;
    reason: string | null;
  };
  "booking.no_show_created": { inviteeId: string; noShowId: string };
  "booking.no_show_deleted": { inviteeId: string; noShowId: string };
  "booking.reconfirmed": { inviteeId: string };
  "booking.host_reassigned": { scheduledEventId: string; fromUserId: string; toUserId: string };
  "meeting.updated": { scheduledEventId: string; fields: ("notes" | "location" | "invitee_limit" | "buffers")[] };
  "event_type.created": { eventTypeId: string };
  "event_type.updated": { eventTypeId: string };
  "event_type.deleted": { eventTypeId: string };
  "routing_form.submitted": { submissionId: string };
  "contact.created": { contactId: string };
  "contact.updated": { contactId: string };
  "contact.deleted": { contactId: string; ownerUserId: string };
  "poll.created": { pollId: string };
  "poll.vote_created": { pollId: string; participantId: string };
  "poll.vote_updated": { pollId: string; participantId: string };
  "poll.booked": { pollId: string; scheduledEventId: string };
  "poll.reopened": { pollId: string };
  "poll.canceled": { pollId: string };
  "payment.succeeded": { paymentId: string };
  "payment.refunded": { paymentId: string };
  "user.created": { userId: string };
  "user.deleted": { userId: string; organizationId: string };
  "calendar.connection_broken": { connectionId: string; userId: string };
};

export type DomainEventType = keyof DomainEventMap;

export type Actor = { type: "user" | "system" | "api" | "invitee"; userId?: string; name?: string };

export type DomainEventMeta = { organizationId: string | null; actor?: Actor };

/** The event a subscriber receives (one job per subscriber key, section 12.1). */
export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  id: string;
  type: T;
  payload: DomainEventMap[T];
  meta: DomainEventMeta;
};

export type SubscriberHandler<T extends DomainEventType> = (event: DomainEvent<T>, ctx: JobContext) => Promise<void>;

/** Shape of every module subscriber file (`export const subscribers: SubscriberMap = {}`). */
export type SubscriberMap = Partial<{ [T in DomainEventType]: SubscriberHandler<T> }>;

/** Every domain event type, for validation and admin filters. */
export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = [
  "booking.created",
  "booking.canceled",
  "booking.rescheduled",
  "booking.no_show_created",
  "booking.no_show_deleted",
  "booking.reconfirmed",
  "booking.host_reassigned",
  "meeting.updated",
  "event_type.created",
  "event_type.updated",
  "event_type.deleted",
  "routing_form.submitted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "poll.created",
  "poll.vote_created",
  "poll.vote_updated",
  "poll.booked",
  "poll.reopened",
  "poll.canceled",
  "payment.succeeded",
  "payment.refunded",
  "user.created",
  "user.deleted",
  "calendar.connection_broken",
];
