// Contract stubs and handover files (ARCHITECTURE section 25, WORKPLAN foundation.handover): every file exists with
// the OWNER header, and every contract module exports its listed names, so module agents can code against them from
// day one.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workplan = JSON.parse(fs.readFileSync(path.join(root, "docs/WORKPLAN.json"), "utf8")) as {
  foundation: { handover: { path: string; owner: string }[] };
};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const header = (owner: string) => `OWNER: ${owner}. Stub created by foundation`;

describe("handover files", () => {
  for (const { path: p, owner } of workplan.foundation.handover) {
    it(`${p} exists with the ${owner} OWNER header`, () => {
      if (p.endsWith("/**")) {
        const dir = path.join(root, p.slice(0, -3));
        expect(fs.existsSync(dir), `${dir} missing`).toBe(true);
        const files = filesUnder(dir);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
          const head = fs.readFileSync(f, "utf8").split("\n").slice(0, 3).join("\n");
          expect(head, path.relative(root, f)).toContain(header(owner));
        }
      } else {
        const file = path.join(root, p);
        expect(fs.existsSync(file), `${p} missing`).toBe(true);
        const head = fs.readFileSync(file, "utf8").split("\n").slice(0, 3).join("\n");
        expect(head).toContain(header(owner));
      }
    });
  }
});

// Library contracts (ARCHITECTURE section 25 module table and the foundation split handovers).
const LIB_CONTRACTS: Record<string, string[]> = {
  "@/lib/slots/types": [],
  "@/lib/holidays": ["getHolidays", "blockedDatesFor", "SUPPORTED_COUNTRIES"],
  "@/lib/availability": ["getDefaultSchedule", "loadScheduleInput", "ensureDefaultSchedule"],
  "@/lib/calendars": [
    "getExternalBusy",
    "listExternalEvents",
    "getDestinationCalendar",
    "upsertLinkedEvent",
    "deleteLinkedEvent",
    "repointLinkedEvents",
    "linkCalendarFromOAuth",
    "getCalendarHealth",
    "replaceImportedBusy",
  ],
  "@/lib/calendars/providers/types": ["ProviderAuthError", "ProviderTransientError"],
  "@/lib/calendars/oauth-connect": ["handleConnectCallback"],
  "@/lib/conferencing": [
    "conferenceMode",
    "getConferencingOptions",
    "createConference",
    "updateConference",
    "deleteConference",
    "resolveConferenceOrganizer",
  ],
  "@/lib/booking": [
    "getAvailability",
    "getBusyForUsers",
    "groupSlotsByLocalDate",
    "createBooking",
    "createReservation",
    "completeReservation",
    "resolveTargetBySlugs",
    "resolveTargetByCode",
    "lockHostsInTx",
    "lockInviteeForChangeInTx",
  ],
  "@/lib/lifecycle": [
    "cancelInvitee",
    "cancelScheduledEvent",
    "rescheduleInvitee",
    "moveScheduledEvent",
    "requestReschedule",
    "markNoShow",
    "unmarkNoShow",
    "updateMeetingNotes",
    "setInviteeLimit",
    "removeInvitee",
    "blockInvitee",
    "unblockInvitee",
    "reassignHost",
    "retryProvisioning",
    "applyExternalCalendarChange",
    "resolveActiveInviteeChain",
  ],
  "@/lib/links": ["resolveBookingCode", "consumeLinkInTx", "getReservedIntervals"],
  "@/lib/polls": ["getPollReservedIntervals", "markPollBookedInTx"],
  "@/lib/polls/voter-oauth": ["handleVoterFreeBusyCallback"],
  "@/lib/payments": ["isPaymentsConfigured", "beginPayment", "getPaymentForInvitee"],
  "@/lib/contacts": ["searchContacts", "upsertContactForInvitee"],
  "@/lib/analytics/track": ["trackPublicEvent"],
  "@/lib/teams": ["listTeamsForUser", "getTeamBySlug", "listOrgMembers", "getTeamPublicProfile", "getPendingInvitation", "acceptInvitationInTx"],
  "@/lib/workflows/seed": ["seedDemo"],
  "@/lib/routing/seed": ["seedDemo"],
  "@/lib/polls/seed": ["seedDemo"],
  "@/lib/auth/signup": ["createUserAccount"],
  "@/lib/auth/totp": ["verifyTotp"],
  "@/lib/auth/policy": ["signupPolicyAllows"],
  "@/lib/auth/oauth/intents": ["dispatchOAuthIntent"],
  "@/lib/email": ["sendEmail", "emailTransportName", "renderEmailLayout", "htmlToText", "escapeHtml", "buildIcs"],
  "@/lib/sms": ["sendSms", "smsTransportName", "verifyTwilioSignature"],
  "@/lib/jobs": ["enqueueJob", "cancelJobs", "runDueJobs", "maybeRunDueJobs", "RetryLaterError", "PermanentJobError"],
  "@/lib/jobs/registry": ["getJobHandler", "JOB_HANDLERS", "PERIODIC_JOBS"],
  "@/lib/events": ["publishEvent"],
  "@/lib/events/registry": ["SUBSCRIBER_REGISTRY", "subscriberKeysFor", "getSubscriber"],
  "@/lib/template": ["renderTemplate", "listTemplateVariables"],
  "@/lib/template-context": ["buildMeetingTemplateContext"],
  "@/lib/i18n": ["getT"],
};

const JOB_FILES = ["calendars", "lifecycle", "workflows", "webhooks", "links", "polls", "payments", "admin", "contacts", "meetings", "booking", "settings", "teams"];
const SUBSCRIBER_FILES = ["lifecycle", "workflows", "webhooks", "contacts", "links", "polls", "analytics", "payments", "routing"];

describe("library contracts", () => {
  for (const [mod, names] of Object.entries(LIB_CONTRACTS)) {
    it(`${mod} exports ${names.join(", ") || "types only"}`, async () => {
      const m = (await import(/* @vite-ignore */ mod)) as Record<string, unknown>;
      for (const n of names) expect(m[n], `${mod}.${n}`).toBeDefined();
    });
  }
  for (const dir of JOB_FILES) {
    it(`@/lib/${dir}/jobs exports handlers and periodic`, async () => {
      const m = (await import(/* @vite-ignore */ `@/lib/${dir}/jobs`)) as { handlers: unknown; periodic: unknown };
      expect(typeof m.handlers).toBe("object");
      expect(Array.isArray(m.periodic)).toBe(true);
    });
  }
  for (const dir of SUBSCRIBER_FILES) {
    it(`@/lib/${dir}/subscribers exports subscribers`, async () => {
      const m = (await import(/* @vite-ignore */ `@/lib/${dir}/subscribers`)) as { subscribers: unknown };
      expect(typeof m.subscribers).toBe("object");
    });
  }
  it("every English namespace and locale index exists", async () => {
    const { EN_CATALOG, CATALOGS } = await import("@/lib/i18n/catalog");
    expect(Object.keys(EN_CATALOG).sort()).toEqual(
      ["booking", "common", "lifecycle", "lifecycle-pages", "payments", "poll-emails", "polls", "routing", "workflows", "zones"].sort(),
    );
    expect(Object.keys(CATALOGS).sort()).toEqual(["de", "en", "es", "fr", "it", "nl", "pt", "uk"]);
  });
});

// Component contracts (ARCHITECTURE sections 20.2 and 25): checked in source to keep the test light.
const COMPONENTS: Record<string, string[]> = {
  "src/components/event-types/location-editor.tsx": ["LocationEditor"],
  "src/components/workflows/event-type-workflows-section.tsx": ["EventTypeWorkflowsSection"],
  "src/components/workflows/host-phone-verification.tsx": ["HostPhoneVerification"],
  "src/components/embed/add-to-website-dialog.tsx": ["AddToWebsiteDialog"],
  "src/components/developer/calendar-feed-card.tsx": ["CalendarFeedCard"],
  "src/components/contacts/contact-picker.tsx": ["ContactPicker"],
  "src/components/contacts/contact-hover-card.tsx": ["ContactHoverCard"],
  "src/components/links/book-meeting-dialog.tsx": ["BookMeetingDialog"],
  "src/components/links/single-use-link-dialog.tsx": ["SingleUseLinkDialog"],
  "src/components/links/share-event-type-dialog.tsx": ["ShareEventTypeDialog"],
  "src/components/links/offer-times-dialog.tsx": ["OfferTimesDialog"],
  "src/components/links/share-availability-dialog.tsx": ["ShareAvailabilityDialog"],
  "src/components/payments/event-type-payment-section.tsx": ["EventTypePaymentSection"],
  "src/components/payments/booking-payment-step.tsx": ["BookingPaymentStep"],
  "src/components/payments/payment-summary.tsx": ["PaymentSummary"],
  "src/components/analytics/trackers.tsx": ["PublicTrackers"],
  "src/components/admin/my-sent-emails.tsx": ["MySentEmails"],
  "src/components/ui/button.tsx": ["Button"],
  "src/components/ui/icon-button.tsx": ["IconButton"],
  "src/components/ui/input.tsx": ["Input"],
  "src/components/ui/textarea.tsx": ["Textarea"],
  "src/components/ui/label.tsx": ["Label"],
  "src/components/ui/form-field.tsx": ["FormField", "FieldError"],
  "src/components/ui/select.tsx": ["Select"],
  "src/components/ui/combobox.tsx": ["Combobox"],
  "src/components/ui/native-select.tsx": ["NativeSelect"],
  "src/components/ui/checkbox.tsx": ["Checkbox"],
  "src/components/ui/radio-group.tsx": ["RadioGroup"],
  "src/components/ui/switch.tsx": ["Switch"],
  "src/components/ui/segmented-control.tsx": ["SegmentedControl"],
  "src/components/ui/tabs.tsx": ["Tabs", "TabsList", "TabsTrigger", "TabsContent"],
  "src/components/ui/route-tabs.tsx": ["RouteTabs"],
  "src/components/ui/dialog.tsx": ["Dialog", "DialogClose"],
  "src/components/ui/sheet.tsx": ["Sheet"],
  "src/components/ui/alert-dialog.tsx": ["AlertDialog", "ConfirmDialog"],
  "src/components/ui/popover.tsx": ["Popover"],
  "src/components/ui/dropdown-menu.tsx": ["DropdownMenu", "DropdownMenuItem", "DropdownMenuSwitchItem"],
  "src/components/ui/tooltip.tsx": ["Tooltip"],
  "src/components/ui/hover-card.tsx": ["HoverCard"],
  "src/components/ui/toast.tsx": ["toast", "Toaster"],
  "src/components/ui/avatar.tsx": ["Avatar", "AvatarGroup"],
  "src/components/ui/badge.tsx": ["Badge"],
  "src/components/ui/chip.tsx": ["Chip"],
  "src/components/ui/card.tsx": ["Card"],
  "src/components/ui/section-card.tsx": ["SectionCard"],
  "src/components/ui/accordion.tsx": ["Accordion", "AccordionItem", "AccordionTrigger", "AccordionContent"],
  "src/components/ui/collapsible.tsx": ["Collapsible"],
  "src/components/ui/separator.tsx": ["Separator"],
  "src/components/ui/scroll-area.tsx": ["ScrollArea"],
  "src/components/ui/visually-hidden.tsx": ["VisuallyHidden"],
  "src/components/ui/kbd.tsx": ["Kbd"],
  "src/components/ui/spinner.tsx": ["Spinner"],
  "src/components/ui/skeleton.tsx": ["Skeleton"],
  "src/components/ui/progress-bar.tsx": ["ProgressBar"],
  "src/components/ui/stepper.tsx": ["Stepper"],
  "src/components/ui/empty-state.tsx": ["EmptyState"],
  "src/components/ui/page-header.tsx": ["PageHeader"],
  "src/components/ui/banner.tsx": ["Banner"],
  "src/components/ui/table.tsx": ["Table"],
  "src/components/ui/data-table.tsx": ["DataTable"],
  "src/components/ui/pagination.tsx": ["Pagination"],
  "src/components/ui/search-input.tsx": ["SearchInput"],
  "src/components/ui/copy-button.tsx": ["CopyButton"],
  "src/components/ui/color-picker.tsx": ["ColorPicker"],
  "src/components/ui/time-zone-select.tsx": ["TimeZoneSelect", "TimeZoneButton"],
  "src/components/ui/time-input.tsx": ["TimeInput"],
  "src/components/ui/duration-select.tsx": ["DurationSelect"],
  "src/components/ui/month-calendar.tsx": ["MonthCalendar"],
  "src/components/ui/date-picker.tsx": ["DatePicker", "DateRangePicker"],
  "src/components/ui/phone-input.tsx": ["PhoneInput"],
  "src/components/ui/rich-text-editor.tsx": ["RichTextEditor"],
  "src/components/ui/chips-input.tsx": ["ChipsInput"],
  "src/components/ui/file-upload.tsx": ["FileUpload"],
  "src/components/ui/sticky-footer-bar.tsx": ["StickyFooterBar"],
  "src/components/ui/bulk-action-bar.tsx": ["BulkActionBar"],
  "src/components/ui/provider-logo.tsx": ["ProviderLogo"],
  "src/components/ui/logo.tsx": ["Logo"],
  "src/components/public/powered-by-ribbon.tsx": ["PoweredByRibbon"],
  "src/components/public/public-card.tsx": ["PublicCard"],
  "src/components/public/public-page-shell.tsx": ["PublicPageShell"],
  "src/components/public/public-footer-links.tsx": ["PublicFooterLinks"],
  "src/components/public/cookie-banner.tsx": ["CookieBanner"],
  "src/components/public/cookie-settings-dialog.tsx": ["CookieSettingsDialog"],
  "src/components/shell/app-sidebar.tsx": ["AppSidebar"],
  "src/components/shell/app-header.tsx": ["AppHeader"],
  "src/components/shell/account-menu.tsx": ["AccountMenu"],
  "src/components/shell/create-menu.tsx": ["CreateMenu"],
  "src/components/shell/help-menu.tsx": ["HelpMenu"],
  "src/components/shell/calendar-problem-banner.tsx": ["CalendarProblemBanner"],
  "src/components/shell/verify-email-banner.tsx": ["VerifyEmailBanner"],
  "src/components/shell/time-zone-mismatch-banner.tsx": ["TimeZoneMismatchBanner"],
  "src/components/shell/cron-warning-banner.tsx": ["CronWarningBanner"],
};

describe("component contracts", () => {
  for (const [file, names] of Object.entries(COMPONENTS)) {
    it(`${file} exports ${names.join(", ")}`, () => {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      for (const n of names) expect(src, `${file}: ${n}`).toMatch(new RegExp(`export (async )?(function|const) ${n}\\b`));
    });
  }

  it("the sidebar lists every GEN-20 nav item in order", async () => {
    const { ALL_NAV } = await import("@/components/shell/nav");
    expect(ALL_NAV.map((i) => [i.label, i.href])).toEqual([
      ["Scheduling", "/app/scheduling"],
      ["Meetings", "/app/meetings"],
      ["Availability", "/app/availability"],
      ["Contacts", "/app/contacts"],
      ["Workflows", "/app/workflows"],
      ["Integrations & apps", "/app/integrations"],
      ["Routing", "/app/routing"],
      ["Analytics", "/app/analytics"],
      ["Admin center", "/app/admin"],
    ]);
  });
});
