// The request proxy's routing decision (src/proxy.ts; ARCHITECTURE section 4, SPEC GEN-08, GEN-09). Pure and
// dependency free (no Next imports, no path aliases) so unit tests, e2e specs and the proxy share exactly this code:
// - setup mode (VERCEL=1 without DATABASE_URL or POSTGRES_URL): pages get the setup page (503), APIs get 503
//   setup_required, except /api/health, /setup and static files;
// - /app/* without a session cookie redirects to /login?next=<path and query>.
// - Requests to a retired address (LEGACY_HOSTS) get a 308 to the same path on APP_URL, except /api/*: webhooks
//   registered with the old address (Google Calendar push channels, up to 7 days) do not follow redirects.

type Env = Record<string, string | undefined>;

export type ProxyDecision =
  | { kind: "next" }
  | { kind: "setup_page" }
  | { kind: "setup_api" }
  | { kind: "login_redirect"; location: string }
  | { kind: "host_redirect"; location: string };

/** Addresses the app used to live at; page requests there are forwarded to APP_URL. */
export const LEGACY_HOSTS: readonly string[] = ["calendar-scheduler-smoky.vercel.app"];

/** The 308 target for a page request on a retired address, or null (other hosts, /api/*, or no APP_URL elsewhere). */
export function legacyHostRedirect(input: { host?: string | null; pathname: string; search?: string; env?: Env }): string | null {
  const host = (input.host ?? "").toLowerCase();
  if (!host || !LEGACY_HOSTS.includes(host)) return null;
  const { pathname } = input;
  if (pathname === "/api" || pathname.startsWith("/api/")) return null;
  const env = input.env ?? process.env;
  let target: URL;
  try {
    target = new URL((env.APP_URL ?? "").trim());
  } catch {
    return null;
  }
  if (target.host.toLowerCase() === host) return null;
  return `${target.origin}${pathname}${input.search ?? ""}`;
}

/** True on Vercel without DATABASE_URL or POSTGRES_URL (the app can only show the setup page). */
export function isSetupMode(env: Env = process.env): boolean {
  return env.VERCEL === "1" && !(env.DATABASE_URL || env.POSTGRES_URL);
}

const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|map|txt|xml|json|woff2?|ttf|otf|webmanifest)$/i;

/** The proxy's decision for a request (pure; unit tested). */
export function proxyDecision(input: { pathname: string; search?: string; hasSession: boolean; host?: string | null; env?: Env }): ProxyDecision {
  const { pathname } = input;
  const env = input.env ?? process.env;
  const moved = legacyHostRedirect({ host: input.host, pathname, search: input.search, env });
  if (moved) return { kind: "host_redirect", location: moved };
  if (isSetupMode(env)) {
    if (pathname.startsWith("/_next/") || STATIC_FILE.test(pathname)) return { kind: "next" };
    if (pathname === "/api/health" || pathname.startsWith("/api/health/")) return { kind: "next" };
    if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "setup_api" };
    if (pathname === "/setup" || pathname.startsWith("/setup/")) return { kind: "next" };
    return { kind: "setup_page" };
  }
  if ((pathname === "/app" || pathname.startsWith("/app/")) && !input.hasSession) {
    const next = `${pathname}${input.search ?? ""}`;
    return { kind: "login_redirect", location: `/login?next=${encodeURIComponent(next)}` };
  }
  return { kind: "next" };
}
