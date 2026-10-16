// Editor option labels (SPEC ET-21 buffers, ET-23 increments): Calendly's duration style, where "hr" is never plural
// ("30 min", "1 hr", "2 hr", "1 hr 30 min"), the same as formatDuration on booking pages and in summaries.
import { describe, expect, it } from "vitest";
import { minutesLabel } from "@/components/event-types/editor/fields";
import { formatDuration } from "@/lib/time/format";

describe("minutesLabel", () => {
  it("labels buffer and increment presets like Calendly", () => {
    expect(minutesLabel(0)).toBe("0 min");
    expect(minutesLabel(15)).toBe("15 min");
    expect(minutesLabel(60)).toBe("1 hr");
    expect(minutesLabel(90)).toBe("1.5 hr");
    expect(minutesLabel(120)).toBe("2 hr");
    expect(minutesLabel(150)).toBe("2.5 hr");
    expect(minutesLabel(180)).toBe("3 hr");
  });

  it("spells other custom values as hours and minutes, matching formatDuration", () => {
    expect(minutesLabel(75)).toBe("1 hr 15 min");
    expect(minutesLabel(135)).toBe("2 hr 15 min");
    expect(minutesLabel(135)).toBe(formatDuration(135));
    for (const m of [60, 75, 90, 120, 135, 150, 180, 600]) expect(minutesLabel(m)).not.toMatch(/hrs/);
  });
});
