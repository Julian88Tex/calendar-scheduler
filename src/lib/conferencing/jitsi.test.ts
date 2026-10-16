// Jitsi rooms (SPEC VID-10): unique, unguessable rooms on the configurable base URL.
import { afterEach, describe, expect, it } from "vitest";
import { jitsiConference } from "./jitsi";

const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  delete env.JITSI_BASE_URL;
});

describe("jitsiConference", () => {
  it("creates a pushed meeting with a unique, unguessable room", () => {
    const rooms = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const loc = jitsiConference();
      expect(loc.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/kairos-[a-z0-9]{20}$/);
      expect(loc).toMatchObject({ kind: "jitsi_conference", status: "pushed", location: loc.joinUrl, error: null });
      expect(loc.joinUrl).toBe(`https://meet.jit.si/${loc.providerMeetingId}`);
      rooms.add(loc.providerMeetingId!);
    }
    expect(rooms.size).toBe(2000);
  });

  it("uses JITSI_BASE_URL without a trailing slash", () => {
    env.JITSI_BASE_URL = "https://jitsi.example.com/";
    expect(jitsiConference().joinUrl).toMatch(/^https:\/\/jitsi\.example\.com\/kairos-[a-z0-9]{20}$/);
  });
});
