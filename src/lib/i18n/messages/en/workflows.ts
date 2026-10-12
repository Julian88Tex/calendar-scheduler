// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "workflows" namespace (ARCHITECTURE section 19): default basic notification and gallery templates, appended link labels, reconfirm page.
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  links: { needChanges: "Need to make changes to this event?", cancel: "Cancel", reschedule: "Reschedule" },
  reconfirm: { title: "Confirm your attendance", button: "Confirm", done: "Thanks for confirming!" },
};

export default messages;
