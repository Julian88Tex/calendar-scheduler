// OWNER: lifecycle-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "lifecycle" namespace (ARCHITECTURE section 19): booking emails and ICS descriptions.
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  emails: {
    confirmationSubject: "Confirmed: {eventName} with {hostName} on {date}",
    canceledSubject: "Canceled: {eventName} with {hostName} on {date}",
    rescheduledSubject: "Updated: {eventName} with {hostName} on {date}",
    reason: "Reason: {reason}",
    cancel: "Cancel",
    reschedule: "Reschedule",
  },
  ics: { needChanges: "Need to make changes to this event?" },
};

export default messages;
