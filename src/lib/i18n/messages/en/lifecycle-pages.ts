// OWNER: lifecycle-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "lifecycle-pages" namespace (ARCHITECTURE section 19): cancel and reschedule pages.
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  cancel: {
    title: "Cancel Event",
    reasonLabel: "Reason for canceling",
    submit: "Cancel Event",
    done: "Cancellation Confirmed",
  },
  reschedule: {
    title: "Reschedule Event",
    formerTime: "Former Time",
    reasonLabel: "Reason for change",
    submit: "Update Event",
    cannotReschedule: "This event can no longer be rescheduled.",
  },
};

export default messages;
