// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "common" namespace (ARCHITECTURE section 19): time zone picker, cookie banner, footer links, generic errors,
// date words. English files define the key type; other locales are DeepPartial of it. Placeholders use {name}.
const common = {
  timeZone: {
    label: "Time zone",
    search: "Search...",
    noResults: "No time zones found",
    currentTime: "Current time",
  },
  timeFormat: {
    label: "Time format",
    h12: "am/pm",
    h24: "24h",
  },
  cookies: {
    bannerText: "We use cookies to understand how this page is used.",
    acceptAll: "Accept all",
    rejectAll: "Reject all",
    settings: "Cookie settings",
    save: "Save settings",
  },
  footer: {
    cookieSettings: "Cookie settings",
    privacyPolicy: "Privacy Policy",
    reportAbuse: "Report abuse",
    poweredBy: "Powered by {appName}",
  },
  errors: {
    generic: "Something went wrong. Try again.",
    notFound: "This page could not be found.",
    rateLimited: "Too many attempts. Try again in {minutes} minutes.",
    offline: "You appear to be offline.",
  },
  date: {
    today: "Today",
    tomorrow: "Tomorrow",
    yesterday: "Yesterday",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    minutes: "{count} min",
    hours: "{count} hr",
  },
  actions: {
    back: "Back",
    next: "Next",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    save: "Save",
  },
};

export default common;
