// Route handler helpers (ARCHITECTURE sections 18.5 and 21).
//
//   export const POST = route(async (request) => {
//     assertSameOrigin(request);                       // cookie-authenticated mutations (CSRF, GEN-08)
//     const user = await requireUser({ onMissing: "throw" });
//     const input = await readJsonBody(request, Input);
//     return json({ ok: true });
//   });
//
// route() maps AppError, SetupRequiredError and ZodError to JSON errors ({ error: code, message, fieldErrors? }) and
// logs unexpected errors with a request id (never leaking internals).
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { AppError, isAppError, toAppError, type ErrorCode, type FieldErrors } from "./errors";
import { log, newRequestId } from "./logger";
import { appUrl } from "./url";

/** Cache headers for dynamic, per-user or capability responses. */
export function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0" };
}

/** JSON response, no-store by default (pass headers to override). */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(data, { ...init, headers });
}

export type ApiErrorBody = { error: ErrorCode; message: string; fieldErrors?: FieldErrors; details?: Record<string, unknown> };

/** JSON error response from a code, an AppError or any thrown value (unknown errors become "internal"). */
export function apiError(
  error: ErrorCode | AppError | unknown,
  opts: { message?: string; status?: number; fieldErrors?: FieldErrors; headers?: HeadersInit } = {},
): Response {
  const app =
    typeof error === "string" && !isAppError(error)
      ? new AppError(error as ErrorCode, opts.message)
      : toAppError(error);
  const body: ApiErrorBody = {
    error: app.code,
    message: opts.message ?? app.message,
    ...(opts.fieldErrors || app.fieldErrors ? { fieldErrors: opts.fieldErrors ?? app.fieldErrors } : {}),
    ...(app.details ? { details: app.details } : {}),
  };
  const headers = new Headers(opts.headers);
  const retry = app.details?.retryAfterSeconds;
  if (app.code === "rate_limited" && typeof retry === "number" && !headers.has("Retry-After")) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil(retry))));
  }
  return json(body, { status: opts.status ?? app.status, headers });
}

function isNextInternal(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND" || digest === "DYNAMIC_SERVER_USAGE");
}

function isZodError(e: unknown): e is z.ZodError {
  return Boolean(e && typeof e === "object" && (e as { name?: unknown }).name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues));
}

/** Field errors keyed by dotted input path ("_form" for root issues). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

type Handler<C> = (request: Request, ctx: C) => Promise<Response> | Response;

/** Wraps a route handler with error mapping (see the file header). Next redirect/notFound signals are rethrown. */
export function route<C = unknown>(handler: Handler<C>): (request: Request, ctx: C) => Promise<Response> {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx);
    } catch (e) {
      unstable_rethrow(e);
      if (isNextInternal(e)) throw e;
      if (isZodError(e)) return apiError(new AppError("validation", { fieldErrors: zodFieldErrors(e) }));
      const app = toAppError(e);
      if (app.code === "internal") {
        const requestId = newRequestId();
        log.error("route.unhandled", { requestId, method: request.method, path: safePath(request.url), error: e });
        return apiError(app, { headers: { "x-request-id": requestId } });
      }
      return apiError(app);
    }
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Parses a JSON body with a zod schema; throws AppError("validation") with field errors. */
export async function readJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new AppError("validation", "The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", { fieldErrors: zodFieldErrors(parsed.error) });
  return parsed.data;
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The host the request was addressed to (x-forwarded-host first, as on Vercel). */
export function requestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host") || hostOf(request.url);
  return host ? host.toLowerCase() : null;
}

/**
 * CSRF check for cookie-authenticated mutating route handlers (POST, PUT, PATCH, DELETE; ARCHITECTURE 18.5): accepts
 * when `Origin` matches APP_URL or the request host, or when `Sec-Fetch-Site` is `same-origin`. Otherwise throws
 * AppError("forbidden") (403). Safe methods (GET, HEAD, OPTIONS) always pass.
 */
export function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  if (isSameOrigin(request)) return;
  throw new AppError("forbidden", "Cross-site request blocked.");
}

/** The boolean form of assertSameOrigin for mutating requests. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    const host = hostOf(origin);
    if (host && (host === hostOf(appUrl()) || host === requestHost(request))) return true;
    return false;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** The client IP (first x-forwarded-for hop, Vercel and proxies), or null. */
export function getClientIp(request: Request | Headers): string | null {
  const h = request instanceof Headers ? request : request.headers;
  const candidates = [
    h.get("x-vercel-forwarded-for"),
    h.get("x-forwarded-for"),
    h.get("x-real-ip"),
    h.get("cf-connecting-ip"),
  ];
  for (const c of candidates) {
    const first = c?.split(",")[0]?.trim();
    if (first) return first.replace(/^\[|\]$/g, "").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  }
  return null;
}

/** The request's user agent (truncated to 512 characters), or null. */
export function getUserAgent(request: Request | Headers): string | null {
  const h = request instanceof Headers ? request : request.headers;
  const ua = h.get("user-agent");
  return ua ? ua.slice(0, 512) : null;
}
