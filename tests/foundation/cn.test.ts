import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("keeps custom font-size tokens next to text colors", () => {
    expect(cn("text-label text-ink")).toBe("text-label text-ink");
    expect(cn("text-body-sm", "text-ink-secondary")).toBe("text-body-sm text-ink-secondary");
  });
  it("still resolves conflicts between font sizes and between colors", () => {
    expect(cn("text-label", "text-title-md")).toBe("text-title-md");
    expect(cn("text-ink", "text-primary")).toBe("text-primary");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
