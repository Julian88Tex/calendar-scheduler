// Template engine (SPEC NT-07, ARCHITECTURE section 13.2): {{var}} replacement, unknown variables empty, HTML escaping,
// aliases and the "+ Variables" menu labels.
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_KEYS,
  TEMPLATE_PREVIEW_CONTEXT,
  listTemplateVariables,
  renderTemplate,
  smsOnlyVariablesIn,
  templateVariablesIn,
  unknownTemplateVariables,
} from "@/lib/template";

describe("renderTemplate", () => {
  it("replaces variables, tolerates whitespace and case, and renders unknown variables as empty text", () => {
    const ctx = { invitee_first_name: "Sam", event_time: "10:00am", invitees_count: 3, missing: null };
    expect(renderTemplate("Hi {{invitee_first_name}}, see you at {{ event_time }}.", ctx)).toBe("Hi Sam, see you at 10:00am.");
    expect(renderTemplate("{{INVITEE_FIRST_NAME}} x{{invitees_count}}", ctx)).toBe("Sam x3");
    expect(renderTemplate("[{{nope}}][{{missing}}]", ctx)).toBe("[][]");
    expect(renderTemplate("{single} {{ bad-key }}", ctx)).toBe("{single} {{ bad-key }}");
    expect(renderTemplate("", ctx)).toBe("");
  });

  it("supports the host_name alias of my_name", () => {
    expect(renderTemplate("{{host_name}} / {{my_name}}", { my_name: "Jordan" })).toBe("Jordan / Jordan");
  });

  it("escapes values in HTML mode and keeps line breaks", () => {
    expect(renderTemplate("<p>{{x}}</p>", { x: `<b>"A" & 'B'</b>\nnext` }, { escape: "html" })).toBe(
      "<p>&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;<br>next</p>",
    );
    expect(renderTemplate("{{x}}", { x: "<b>" })).toBe("<b>");
  });

  it("does not resolve inherited object properties", () => {
    expect(renderTemplate("{{constructor}}{{tostring}}", {})).toBe("");
  });
});

describe("variables menu", () => {
  it("lists every NT-07 label in menu order", () => {
    expect(listTemplateVariables().map((v) => v.label)).toEqual([
      "Event Name",
      "Event Organizer Name",
      "Event Date",
      "Event Time",
      "Event End Time",
      "Event Time Zone",
      "Event Description",
      "Invitees count",
      "Questions and Answers",
      ...Array.from({ length: 10 }, (_, i) => `Answer ${i + 1}`),
      "Invitee First Name",
      "Invitee Last Name",
      "Invitee Full Name",
      "Invitee Email",
      "Invitee Phone Number",
      "Invitee UUID",
      "Guests",
      "UTM Source",
      "UTM Medium",
      "UTM Campaign",
      "UTM Content",
      "UTM Term",
      "Location",
      "Join link",
      "Cancel link",
      "Reschedule link",
      "Reconfirm link",
    ]);
    expect(listTemplateVariables().find((v) => v.key === "invitee_phone_number")?.smsOnly).toBe(true);
    // Returned copies cannot mutate the catalog.
    listTemplateVariables()[0]!.label = "x";
    expect(listTemplateVariables()[0]!.label).toBe("Event Name");
  });

  it("knows every NT-07 key, finds used, unknown and SMS-only variables, and previews every key", () => {
    for (const k of ["event_name", "event_end_time", "event_time_zone", "join_url", "host_email", "host_name", "event_type_url", "reconfirm_url"]) {
      expect(TEMPLATE_KEYS).toContain(k);
    }
    const tpl = "{{event_name}} {{Event_Name}} {{foo}} {{invitee_phone_number}}";
    expect(templateVariablesIn(tpl)).toEqual(["event_name", "foo", "invitee_phone_number"]);
    expect(unknownTemplateVariables(tpl)).toEqual(["foo"]);
    expect(smsOnlyVariablesIn(tpl)).toEqual(["invitee_phone_number"]);
    for (const k of TEMPLATE_KEYS.filter((k) => k !== "host_name")) expect(TEMPLATE_PREVIEW_CONTEXT[k], k).not.toBeUndefined();
  });
});
