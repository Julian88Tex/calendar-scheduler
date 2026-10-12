// OWNER: workflows.
//
// English "workflows" namespace (ARCHITECTURE section 19, SPEC NT-09, GEN-10): the invitee-facing defaults of the
// reminder notifications, rendered in the recipient's language. {{variables}} are template variables (NT-07) and
// stay as written in translations. The default message (greeting and body) is what the reminder editor shows; while
// the host keeps it, the email uses Calendly's reminder layout with the event details blocks
// (src/lib/email/meeting-templates.ts), whose greeting and sentence match these strings (checked by a unit test).
// English files define the key type; other locales are DeepPartial of it.
const messages = {
  reminders: {
    invitee: {
      subject: "Reminder: {{event_name}} with {{my_name}} at {{event_time}} {{event_date}}",
      greeting: "Hi {{invitee_first_name}},",
      body: "This is a friendly reminder that {{event_name}} with {{my_name}} is at {{event_time}} on {{event_date}}.",
    },
    host: {
      subject: "Reminder: {{event_name}} with {{invitee_full_name}} at {{event_time}} {{event_date}}",
      greeting: "Hi {{my_name}},",
      body: "This is a friendly reminder that {{event_name}} with {{invitee_full_name}} is at {{event_time}} on {{event_date}}.",
    },
  },
  /** The link block appended to invitee reminders (rendered by the email core from the common namespace). */
  links: { needChanges: "Need to make changes to this event?", cancel: "Cancel", reschedule: "Reschedule" },
};

export default messages;
