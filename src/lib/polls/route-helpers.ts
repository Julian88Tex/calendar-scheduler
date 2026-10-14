// Shared bits of the /api/polls/** (signed-in hosts, cookie session) and /api/public/polls/** (voters) route handlers.
// Mutating host routes check the origin (CSRF, ARCHITECTURE 18.5); ids in paths are validated before any query.
// Server only.
import "server-only";
import { getApiActorCtx, type ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, json } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { POLL_ERRORS } from "./constants";

export type PollRouteCtx = { params: Promise<{ id: string }> };
export type PollChildRouteCtx<K extends string> = { params: Promise<{ id: string } & Record<K, string>> };
export type PublicPollRouteCtx = { params: Promise<{ slug: string }> };
export type PublicPollChildRouteCtx<K extends string> = { params: Promise<{ slug: string } & Record<K, string>> };

/** The signed-in host (401 when signed out); mutating methods must come from this origin. */
export async function hostActor(request: Request): Promise<ActorCtx> {
  assertSameOrigin(request);
  return getApiActorCtx();
}

/** A uuid path segment, or 404 with `message`. */
export function uuidParam(value: string | undefined, message: string = POLL_ERRORS.notFound): string {
  if (!value || !isUuid(value)) throw new AppError("not_found", message);
  return value.toLowerCase();
}

/** A poll slug path segment (lowercased), or 404. */
export function slugParam(value: string | undefined): string {
  let v = (value ?? "").trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    throw new AppError("not_found", POLL_ERRORS.notFound);
  }
  v = v.toLowerCase();
  if (!v || v.length > 100 || !/^[a-z0-9-]+$/.test(v)) throw new AppError("not_found", POLL_ERRORS.notFound);
  return v;
}

/** Boolean query flags: "1" / "true" / "yes" are true, "0" / "false" / "no" false, anything else the default. */
export function boolParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/** { ok: true, ...data } with status 200 (or `status`). */
export function ok(data: Record<string, unknown> = {}, status = 200): Response {
  return json({ ok: true, ...data }, { status });
}
