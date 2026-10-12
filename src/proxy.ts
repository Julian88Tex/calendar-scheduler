// Request proxy (Next 16 "middleware"; ARCHITECTURE section 4, SPEC GEN-08, GEN-09; tech-reference 1.5).
// Node runtime, cheap checks only (no database):
// - Setup gating: on Vercel (VERCEL=1) without a database URL every page request is answered with the setup page and
//   status 503 (the /setup page itself renders normally), and API requests get 503 { "error": "setup_required" },
//   except /api/health. getDb() throws SetupRequiredError as the second line of defense.
// - /app/* without a `sid` cookie redirects to /login?next=... (the real session check happens in server code).
// - Passes the current path to server code in the x-kairos-url request header (login redirects keep ?next=).
// - Security headers (GEN-08) for normal responses come from next.config.ts headers(); responses generated here get
//   the same headers from src/lib/net/frame-policy.ts.
// Never import the database, env.ts or "server-only" modules here.
import { NextResponse, type NextRequest } from "next/server";
import { securityHeadersFor } from "./lib/net/frame-policy";
import { proxyDecision } from "./lib/net/proxy-decision";

export const SESSION_COOKIE_NAME = "sid";
export const PATHNAME_HEADER = "x-kairos-url";

export { isSetupMode, proxyDecision, type ProxyDecision } from "./lib/net/proxy-decision";

function withSecurityHeaders(res: NextResponse, pathname: string): NextResponse {
  for (const h of securityHeadersFor(pathname)) res.headers.set(h.key, h.value);
  return res;
}

function fallbackSetupHtml(): string {
  const name = (process.env.NEXT_PUBLIC_APP_NAME || "Kairos").replace(/[<>&"]/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Finish setting up ${name}</title></head><body style="font-family:system-ui,sans-serif;color:#0a2540;max-width:640px;margin:48px auto;padding:0 16px"><h1>Finish setting up ${name}</h1><p>${name} needs a Postgres database before it can run.</p><ol><li>Open your project in Vercel</li><li>Go to the Storage tab</li><li>Create a Neon Postgres database and connect it to this project (all environments)</li><li>Redeploy</li></ol><p><a href="/setup">Open the setup page</a></p></body></html>`;
}

/** The setup page body with status 503: renders /setup (foundation-auth) and falls back to a static page. */
async function setupPageResponse(request: NextRequest): Promise<NextResponse> {
  const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "300" };
  try {
    const url = new URL("/setup", request.nextUrl.origin);
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const res = await fetch(url, {
      headers: { accept: "text/html", ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
      return new NextResponse(await res.text(), { status: 503, headers });
    }
  } catch {
    // fall through to the static page
  }
  return new NextResponse(fallbackSetupHtml(), { status: 503, headers });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const decision = proxyDecision({ pathname, search, hasSession: request.cookies.has(SESSION_COOKIE_NAME) });
  switch (decision.kind) {
    case "setup_api":
      return withSecurityHeaders(
        NextResponse.json(
          { error: "setup_required", message: "A Postgres database is required. Connect one in Vercel (Storage tab) and redeploy." },
          { status: 503, headers: { "cache-control": "no-store", "retry-after": "300" } },
        ),
        pathname,
      );
    case "setup_page":
      return withSecurityHeaders(await setupPageResponse(request), "/setup");
    case "login_redirect":
      return withSecurityHeaders(NextResponse.redirect(new URL(decision.location, request.url)), pathname);
    case "next": {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }
}

export const config = {
  // Everything except Next internals, image optimization and static assets (by extension). API routes are included
  // for setup gating.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|css|js|mjs|map|woff2?|ttf|otf|webmanifest)$).*)",
  ],
};
