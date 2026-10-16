// OWNER: booking-pages.
//
// Renders an OgCard (og-card.ts) to a 1200x630 PNG with next/og. Fonts are the app's Figtree (assets/og, static woff
// files, since the renderer reads neither woff2 nor variable fonts). The host's photo is fetched here and inlined; when
// it cannot be fetched the card shows the host's initials instead, so a slow avatar host never breaks the card.
// Emoji (persona favorites) are drawn as Twemoji images fetched here too, and left out when they cannot be fetched
// (the renderer's own emoji loader fails the whole image instead). Server only.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { OgCard } from "./og-card";
import { OG_SIZE } from "./og-card";
import { balancedRowEnds } from "@/components/public/persona-landing";
import { appUrl } from "@/lib/url";

const PALETTES = {
  classic: { canvas: "#f4f8ff", card: "#ffffff", line: "#d4e0ed", ink: "#0a2540", ink2: "#476788", accent: "#006bff", accentText: "#004eba", soft: "#e6f0ff", ring: "#e6f0ff", radius: 24 },
  warm: { canvas: "#fbf3e8", card: "#fffaf3", line: "#ecdccb", ink: "#3d2a1e", ink2: "#7a5a45", accent: "#b5482a", accentText: "#9c3d22", soft: "#f7dccd", ring: "#f7dccd", radius: 40 },
} as const;

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 800; style: "normal" }[]> | null = null;

function loadFonts() {
  fonts ??= Promise.all(
    ([400, 600, 800] as const).map(async (weight) => ({
      name: "Figtree",
      data: await readFile(join(process.cwd(), "assets/og", `figtree-latin-${weight}-normal.woff`)),
      weight,
      style: "normal" as const,
    })),
  ).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

/** A large version of the avatar URL (Google photos carry their size in the URL, "=s96-c"). */
export function largeAvatarUrl(url: string): string {
  const abs = url.startsWith("/") ? `${appUrl()}${url}` : url;
  return abs.replace(/=s\d+(-[a-z]+)?$/, "=s512-c");
}

async function avatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(largeAvatarUrl(url), { headers: { Accept: "image/png,image/jpeg" }, signal: AbortSignal.timeout(3000) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !/^image\/(png|jpe?g)$/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

const TWEMOJI = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg";

/** Twemoji's file name for an emoji ("1f355", "1f6b6-200d-2642"). */
export function twemojiCode(emoji: string): string {
  const chars = emoji.includes("\u200d") ? [...emoji] : [...emoji].filter((ch) => ch !== "\ufe0f");
  return chars.map((ch) => ch.codePointAt(0)!.toString(16)).join("-");
}

async function emojiDataUrl(emoji: string): Promise<string | null> {
  if (!emoji.trim()) return null;
  try {
    const res = await fetch(`${TWEMOJI}/${twemojiCode(emoji.trim())}.svg`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** The card's text limited to what the bundled Latin font draws (other characters make the renderer fetch fonts). */
export function latinOnly(card: OgCard): OgCard {
  const keep = (t: string) => t.replace(/[^\u0020-\u024f\u2010-\u2027\u2030-\u203a]/gu, "").replace(/\s+/g, " ").trim();
  return {
    ...card,
    eyebrow: keep(card.eyebrow),
    headline: keep(card.headline) || keep(card.hostName) || "Book a time",
    body: card.body ? keep(card.body) || null : null,
    hostName: keep(card.hostName),
    footer: keep(card.footer),
    chips: card.chips.map((f) => ({ ...f, label: keep(f.label) })).filter((f) => f.label),
  };
}

/**
 * The card as a finished PNG response. Rendered fully before answering, so a failure (a character the bundled font
 * lacks whose fallback font cannot be fetched) is caught and the card drawn again with Latin text only.
 */
export async function renderOgImage(card: OgCard, init?: ResponseInit): Promise<Response> {
  let png: ArrayBuffer;
  try {
    png = await (await drawCard(card)).arrayBuffer();
  } catch {
    png = await (await drawCard(latinOnly(card))).arrayBuffer();
  }
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "image/png");
  return new Response(png, { ...init, headers });
}

async function drawCard(card: OgCard): Promise<ImageResponse> {
  const [fontData, avatar, emojis] = await Promise.all([loadFonts(), avatarDataUrl(card.avatarUrl), Promise.all(card.chips.map((f) => emojiDataUrl(f.emoji)))]);
  const c = PALETTES[card.look];
  const warm = card.look === "warm";
  const size = 300;
  const chipRowEnds = balancedRowEnds(card.chips.length, 3);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", padding: 40, background: c.canvas, fontFamily: "Figtree" }}>
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            gap: 56,
            padding: "0 64px",
            background: c.card,
            border: `2px solid ${c.line}`,
            borderRadius: c.radius,
            position: "relative",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", padding: 10, borderRadius: 9999, background: c.ring }}>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img>.
                <img src={avatar} alt="" width={size} height={size} style={{ borderRadius: 9999, objectFit: "cover" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: 9999, background: c.accent, color: "#ffffff", fontSize: 110, fontWeight: 800 }}>
                  {initialsOf(card.hostName)}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: c.accentText }}>{card.eyebrow}</div>
            <div style={{ display: "flex", fontSize: card.headline.length > 28 ? 58 : 72, fontWeight: 800, color: c.ink, lineHeight: 1.05, letterSpacing: -1.5, textWrap: "balance" }}>
              {card.headline}
            </div>
            {card.body && <div style={{ display: "flex", fontSize: 28, color: c.ink2, lineHeight: 1.35, textWrap: "balance" }}>{card.body}</div>}
            {card.chips.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", columnGap: 12, rowGap: 0, marginTop: 4 }}>
                {card.chips.flatMap((f, i) => [
                  <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0", padding: "8px 20px", borderRadius: 9999, background: c.soft, color: c.ink, fontSize: 24, fontWeight: 600 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img>. */}
                    {emojis[i] && <img src={emojis[i]} alt="" width={26} height={26} />}
                    {f.label}
                  </div>,
                  // Even rows, like the landing page: four chips are two and two.
                  chipRowEnds.has(i) ? <div key={`${f.label}-break`} style={{ display: "flex", flexBasis: "100%", height: 0 }} /> : null,
                ])}
              </div>
            )}
          </div>
          <div style={{ display: "flex", position: "absolute", left: 64, right: 64, bottom: 28, justifyContent: "space-between", fontSize: 22, color: c.ink2 }}>
            <div style={{ display: "flex" }}>{card.footer}</div>
            <div style={{ display: "flex", width: warm ? 48 : 120, height: 8, borderRadius: 9999, background: c.accent, marginTop: 8 }} />
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fontData },
  );
}
