// Connect flow results on the Google Meet page: the same messages as Integrations > Google Calendar, unknown codes
// ignored (review regression: "unsupported" and "sign_in_required" were generic, any ?oauth_error= string showed one).
import { describe, expect, it } from "vitest";
import { MEET_NOTICE_PARAMS, meetConnectNotices } from "./notices";

describe("meetConnectNotices", () => {
  it("confirms a connect and warns about a reconnect with another account", () => {
    expect(meetConnectNotices({ connected: "google" }, "Kairos")).toEqual([{ tone: "success", message: "Google Calendar connected" }]);
    const mismatch = meetConnectNotices({ connected: "google", reconnect_mismatch: "1" }, "Kairos");
    expect(mismatch.map((n) => n.tone)).toEqual(["success", "warning"]);
    expect(mismatch[1]!.message).toContain("different Google account");
    expect(meetConnectNotices({ reconnect_mismatch: "1" }, "Kairos")).toEqual([]);
  });

  it("explains calendar errors", () => {
    expect(meetConnectNotices({ calendar_error: "permissions" }, "Kairos")[0]!.message).toBe(
      "Kairos needs permission to see and edit events on your Google Calendar. Connect again and keep both calendar permissions checked on Google's consent screen.",
    );
    expect(meetConnectNotices({ calendar_error: "limit" }, "Kairos")[0]!.message).toBe("You can connect up to 20 calendar accounts. Disconnect one to add another.");
    expect(meetConnectNotices({ calendar_error: "unsupported" }, "Kairos")[0]!.message).toBe("This calendar provider isn't available on this server.");
    expect(meetConnectNotices({ calendar_error: ["failed", "limit"] }, "Kairos")[0]!.message).toBe("We couldn't connect your calendar. Please try again.");
    expect(meetConnectNotices({ calendar_error: "<b>x</b>" }, "Kairos")).toEqual([]);
  });

  it("explains OAuth errors and ignores unknown codes", () => {
    expect(meetConnectNotices({ oauth_error: "canceled" }, "Kairos")).toEqual([{ tone: "warning", message: "Connecting Google Calendar was canceled." }]);
    expect(meetConnectNotices({ oauth_error: "sign_in_required" }, "Kairos")).toEqual([{ tone: "error", message: "Log in to connect your calendar." }]);
    expect(meetConnectNotices({ oauth_error: "expired" }, "Kairos")[0]!.message).toBe("Your connection attempt expired. Please try again.");
    expect(meetConnectNotices({ oauth_error: "account_linked_elsewhere" }, "Kairos")[0]!.message).toBe("We couldn't connect your calendar. Please try again.");
    expect(meetConnectNotices({ oauth_error: "made-up" }, "Kairos")).toEqual([]);
  });

  it("names every parameter it reads, so the page can clean the address bar", () => {
    expect([...MEET_NOTICE_PARAMS].sort()).toEqual(["calendar_error", "connected", "oauth_error", "provider", "reconnect_mismatch"]);
  });
});
