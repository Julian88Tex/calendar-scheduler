// The invitee reschedule flow takes the selected time chip color from the global --slot-selected token (globals.css,
// GEN-05 contrast) like the booking flow, without a duplicate inline override of the same value.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("reschedule flow styles (GEN-05)", () => {
  it("inherits --slot-selected from globals.css instead of overriding it", () => {
    expect(read("src/app/globals.css")).toMatch(/--slot-selected:\s*rgba\(\s*10,\s*37,\s*64,\s*0\.65\s*\)/);
    const flow = read("src/components/lifecycle/reschedule-flow.tsx");
    expect(flow).not.toContain("--slot-selected");
    expect(flow).toContain('data-booking-flow="reschedule-calendar"');
    expect(flow).toContain('data-booking-flow="reschedule-details"');
  });
});
