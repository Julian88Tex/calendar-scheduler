// Token parity (SPEC GEN-03, ARCHITECTURE 20.1): every classic token and @theme inline mapping of ARCHITECTURE 20.1
// appears verbatim in src/app/globals.css; the dark theme (GEN-22) redefines the color tokens under data-theme; the
// typography utilities exist with the documented sizes; the booking calendar tints derive #F4F8FF, #E6F0FF and #004EBA
// from #006BFF.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const arch = fs.readFileSync(path.join(root, "docs/ARCHITECTURE.md"), "utf8");

function block(source: string, selectorPattern: RegExp): string {
  const m = selectorPattern.exec(source);
  if (!m) throw new Error(`block not found: ${selectorPattern}`);
  const start = source.indexOf("{", m.index) + 1;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1]!, m[2]!.trim().replace(/\s+/g, " "));
  return out;
}

const section = arch.slice(arch.indexOf("### 20.1 Tokens"), arch.indexOf("### 20.2 Components"));
const docCss = /```css\n([\s\S]*?)```/.exec(section)![1]!;

describe("design tokens (ARCHITECTURE 20.1)", () => {
  const docRoot = declarations(block(docCss, /:root\s*\{/));
  const docTheme = declarations(block(docCss, /@theme inline\s*\{/));
  const cssRoot = declarations(block(css, /:root,\s*\[data-force-light\]\s*\{/));
  const cssTheme = declarations(block(css, /@theme inline\s*\{/));

  it("parses the documented blocks", () => {
    expect(docRoot.size).toBeGreaterThan(40);
    expect(docTheme.size).toBeGreaterThan(20);
  });

  it("keeps every classic token verbatim on :root (and on [data-force-light] for public pages)", () => {
    for (const [name, value] of docRoot) expect(cssRoot.get(name), name).toBe(value);
  });

  it("keeps every @theme inline mapping", () => {
    for (const [name, value] of docTheme) expect(cssTheme.get(name), name).toBe(value);
  });

  it("imports Tailwind and the class dark variant", () => {
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
  });

  it("has the GEN-03 key colors", () => {
    expect(cssRoot.get("--ink")).toBe("#0a2540");
    expect(cssRoot.get("--ink-2")).toBe("#476788");
    expect(cssRoot.get("--line")).toBe("#d4e0ed");
    expect(cssRoot.get("--canvas")).toBe("#fafafa");
    expect(cssRoot.get("--primary")).toBe("#006bff");
    expect(cssRoot.get("--primary-text")).toBe("#004eba");
    expect(cssRoot.get("--primary-soft")).toBe("#f4f8ff");
    expect(cssRoot.get("--danger")).toBe("#d53c00");
    expect(cssRoot.get("--radius-pill")).toBe("9999px");
    expect(cssRoot.get("--radius-card")).toBe("8px");
    expect(docTheme.get("--font-sans")).toContain('"Figtree Variable"');
  });

  it("redefines the color tokens for dark mode (GEN-22) under data-theme and the system media query", () => {
    const dark = declarations(block(css, /:root\[data-theme="dark"\]\s*\{/));
    const system = declarations(block(block(css, /@media \(prefers-color-scheme: dark\)\s*\{/), /:root\[data-theme="system"\]\s*\{/));
    for (const name of ["--ink", "--ink-2", "--line", "--canvas", "--white", "--primary", "--primary-text", "--primary-soft", "--danger-text", "--success-text", "--warning-text"]) {
      expect(dark.get(name), name).toBeDefined();
      expect(dark.get(name), name).not.toBe(cssRoot.get(name));
      expect(system.get(name), name).toBe(dark.get(name));
    }
  });

  it("defines the typography scale utilities", () => {
    const sizes: Record<string, [string, string | null, string | null]> = {
      "text-headline-2": ["28px", "36px", "700"],
      "text-headline-3": ["24px", "32px", "700"],
      "text-title-lg": ["22px", "28px", "700"],
      "text-title-md": ["18px", "26px", "700"],
      "text-title-sm": ["16px", "24px", "700"],
      "text-body": ["16px", "1.4", null],
      "text-body-md": ["14px", "1.4", null],
      "text-body-sm": ["12px", "1.4", null],
      "text-label": ["14px", "20px", "600"],
    };
    for (const [name, [size, lh, weight]] of Object.entries(sizes)) {
      const body = block(css, new RegExp(`@utility ${name}\\s*\\{`));
      expect(body, name).toContain(`font-size: ${size};`);
      if (lh) expect(body, name).toContain(`line-height: ${lh};`);
      if (weight) expect(body, name).toContain(`font-weight: ${weight};`);
    }
    const eyebrow = block(css, /@utility text-eyebrow\s*\{/);
    expect(eyebrow).toContain("text-transform: uppercase;");
    expect(eyebrow).toContain("letter-spacing: 0.72px;");
  });

  it("derives the booking calendar tints from --primary-color", () => {
    const tint = (pct: number, base: [number, number, number]) => base.map((c) => Math.round(255 + (c - 255) * pct));
    const primary: [number, number, number] = [0x00, 0x6b, 0xff];
    const pct = (name: string) => Number(cssRoot.get(name)!.replace("%", "")) / 100;
    const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    // Mixing with transparent over white equals mixing with white.
    expect(["#f4f8ff", "#f3f8ff"]).toContain(hex(tint(pct("--day-tint"), primary)));
    expect(["#e6f0ff", "#e5f0ff"]).toContain(hex(tint(pct("--day-hover-tint"), primary)));
    // Available booking days use a stronger fill so they stand out on phones and under automatic dark mode.
    expect(["#e6f0ff", "#e5f0ff"]).toContain(hex(tint(pct("--day-fill"), primary)));
    expect(["#d1e4ff", "#d1e5ff"]).toContain(hex(tint(pct("--day-fill-hover"), primary)));
    const text = primary.map((c) => Math.round(c * pct("--day-text-pct")));
    expect(hex(text)).toBe("#004eba");
    expect(css).toMatch(/@utility cal-day-available\s*\{[^}]*var\(--primary-color\)/);
    expect(css).toMatch(/@utility text-brand-strong\s*\{[^}]*var\(--primary-color\)/);
  });

  it("shows a 2px focus ring offset by 2px (GEN-05) and honors reduced motion", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: 2px solid var\(--focus\);\s*outline-offset: 2px;/);
    expect(cssRoot.get("--focus")).toBe("#006bff");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
