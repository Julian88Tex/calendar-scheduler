// Guard for the E2E test API (/api/test/*, ARCHITECTURE section 24.2).
//
// Every route answers 404 unless ALL of these hold:
// - E2E_TEST_MODE=1,
// - process.env.VERCEL is not set (any Vercel deployment, production or preview, refuses it, because a preview may
//   point at the production database),
// - E2E_SECRET is set and the request carries an equal `x-e2e-secret` header (Playwright generates one per run).
// A 404 (not 401/403) keeps the API invisible.
import { timingSafeEqual } from "node:crypto";

export const E2E_SECRET_HEADER = "x-e2e-secret";

type Env = Record<string, string | undefined>;

/** True when the test API may run at all in this process. */
export function testApiEnabled(env: Env = process.env): boolean {
  if (env.VERCEL) return false;
  if (env.E2E_TEST_MODE !== "1") return false;
  return Boolean(env.E2E_SECRET);
}

/** True when this request may use the test API. */
export function isTestApiRequest(request: Request, env: Env = process.env): boolean {
  if (!testApiEnabled(env)) return false;
  const expected = Buffer.from(env.E2E_SECRET ?? "", "utf8");
  const given = Buffer.from(request.headers.get(E2E_SECRET_HEADER) ?? "", "utf8");
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

export function testApiNotFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function testJson(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

/** Wraps a route handler so it answers 404 unless the request passes the guard. */
export function withTestGuard(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!isTestApiRequest(request)) return testApiNotFound();
    try {
      return await handler(request);
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "test_api.failed", message: String(e), stack: (e as Error)?.stack }));
      return testJson({ error: "test_api_failed", message: String(e) }, { status: 500 });
    }
  };
}

/** Parses a JSON body, returning {} for an empty body. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
