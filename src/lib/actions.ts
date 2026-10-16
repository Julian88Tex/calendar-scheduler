// Server Action wrapper (ARCHITECTURE section 18.8 and 26 rule 3).
//
//   "use server";
//   export async function saveThing(raw: unknown) {
//     return runAction(SaveThing, raw, async (input, { actor, db }) => {
//       assertAccess(await eventTypeAccess(actor, input.id), "You can't edit this event type.");
//       return db.transaction((tx) => thingService.save(tx, actor, input));
//     });
//   }
//
// runAction parses (FormData is converted with formDataToObject), authenticates (auth "user", the default, returns
// { ok: false, error: { code: "unauthorized" } } when signed out), rate limits, runs, maps AppError to { ok: false },
// rethrows Next's redirect() and notFound(), and logs unexpected errors with a request id, returning
// { code: "internal", message: "Something went wrong. Try again." }. Field errors use dotted input paths (top-level
// keys match z.flattenError).
import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getDb, type DB } from "@/db";
import { getSession, touchSession } from "./auth/session";
import { loadActorCtx, type ActorCtx } from "./authz";
import { AppError, ERROR_MESSAGES, toAppError, type ErrorCode, type FieldErrors } from "./errors";
import { zodFieldErrors } from "./http";
import { log, newRequestId } from "./logger";
import { assertRateLimit } from "./rate-limit";

export type ActionError = { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError };

export type ActionContext = { actor: ActorCtx; db: DB; requestId: string };
export type PublicActionContext = { actor: ActorCtx | null; db: DB; requestId: string };

export type RunActionOptions<I> = {
  auth?: "user" | "none";
  rateLimit?: { key: (input: I) => string | Promise<string>; limit: number; windowSeconds: number; message?: string };
};

/** { ok: true, data } */
export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** { ok: false, error } from a code or an AppError. */
export function actionError(error: ErrorCode | AppError, message?: string, fieldErrors?: FieldErrors): ActionResult<never> {
  const app = typeof error === "string" ? new AppError(error, message, fieldErrors ? { fieldErrors } : {}) : error;
  return {
    ok: false,
    error: {
      code: app.code,
      message: message ?? app.message,
      ...(fieldErrors || app.fieldErrors ? { fieldErrors: fieldErrors ?? app.fieldErrors } : {}),
    },
  };
}

function isZodError(e: unknown): e is z.ZodError {
  return e instanceof z.ZodError || (e as { name?: unknown } | null)?.name === "ZodError";
}

export async function runAction<I, O>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, ctx: ActionContext) => Promise<O>,
  opts?: RunActionOptions<I> & { auth?: "user" },
): Promise<ActionResult<O>>;
export async function runAction<I, O>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, ctx: PublicActionContext) => Promise<O>,
  opts: RunActionOptions<I> & { auth: "none" },
): Promise<ActionResult<O>>;
export async function runAction<I, O>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (input: I, ctx: PublicActionContext & ActionContext) => Promise<O>,
  opts: RunActionOptions<I> = {},
): Promise<ActionResult<O>> {
  const requestId = newRequestId();
  try {
    const parsed = schema.safeParse(raw instanceof FormData ? formDataToObject(raw) : raw);
    if (!parsed.success) {
      return actionError(new AppError("validation", { fieldErrors: zodFieldErrors(parsed.error) }));
    }
    const input = parsed.data;
    const db = await getDb();

    let actor: ActorCtx | null = null;
    const session = await getSession();
    if (session && !session.session.twoFactorPending) actor = await loadActorCtx(db, session.user);
    if ((opts.auth ?? "user") === "user") {
      if (!actor) return actionError("unauthorized");
      await touchSession().catch((e: unknown) => log.warn("session.touch_failed", { requestId, error: e }));
    }

    if (opts.rateLimit) {
      const key = await opts.rateLimit.key(input);
      await assertRateLimit(key, opts.rateLimit.limit, opts.rateLimit.windowSeconds, { message: opts.rateLimit.message });
    }

    const data = await fn(input, { actor: actor as ActorCtx, db, requestId });
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e); // redirect(), notFound(), forbidden() and dynamic usage signals
    if (isZodError(e)) return actionError(new AppError("validation", { fieldErrors: zodFieldErrors(e) }));
    const app = toAppError(e);
    if (app.code === "internal") {
      log.error("action.failed", { requestId, error: e });
      return { ok: false, error: { code: "internal", message: ERROR_MESSAGES.internal } };
    }
    return actionError(app);
  }
}

/**
 * FormData to a plain object: repeated keys and keys ending in "[]" become arrays; Files are kept; other values are
 * strings (schemas coerce numbers and booleans, see zFormBoolean). Next's internal "$ACTION_" fields are dropped.
 */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of fd.entries()) {
    if (rawKey.startsWith("$ACTION_")) continue;
    const isArray = rawKey.endsWith("[]");
    const key = isArray ? rawKey.slice(0, -2) : rawKey;
    // Never touch Object.prototype through attacker-chosen field names ("__proto__[]", "constructor").
    if (!Object.hasOwn(out, key) && key in out) continue;
    if (isArray) {
      ((out[key] as unknown[] | undefined) ??= []).push(value);
      continue;
    }
    if (key in out) {
      const existing = out[key];
      out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      out[key] = value;
    }
  }
  return out;
}
