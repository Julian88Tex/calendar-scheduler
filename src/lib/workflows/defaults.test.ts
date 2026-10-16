// The reminder defaults the editor shows (workflows namespace) must match what the email core renders for the
// default message (common.meetingEmail), so "keep the default" sends exactly what the host saw (NT-09).
import { describe, expect, it } from "vitest";
import common from "@/lib/i18n/messages/en/common";
import workflows from "@/lib/i18n/messages/en/workflows";
import { renderTemplate } from "@/lib/template";

describe("reminder defaults", () => {
  it("match the email core's reminder copy", () => {
    const m = common.meetingEmail;
    expect(workflows.reminders.invitee.subject).toBe(m.subjects.reminder);
    expect(workflows.reminders.host.subject).toBe(m.subjects.hostReminder);
    expect(workflows.reminders.invitee.body).toBe(m.intro.reminder);
    expect(workflows.reminders.host.body).toBe(m.intro.hostReminder);
    expect(workflows.reminders.invitee.greeting).toBe(renderTemplate(m.greeting.named, { name: "{{invitee_first_name}}" }));
    expect(workflows.reminders.host.greeting).toBe(renderTemplate(m.greeting.named, { name: "{{my_name}}" }));
  });

  it("use the link labels of the email core", () => {
    expect(workflows.links.needChanges).toBe(common.meeting.needChanges);
    expect(workflows.links.cancel).toBe(common.meeting.cancel);
    expect(workflows.links.reschedule).toBe(common.meeting.reschedule);
  });
});
