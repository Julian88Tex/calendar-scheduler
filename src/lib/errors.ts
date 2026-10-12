// Typed application errors (ARCHITECTURE sections 18.8 and 26 rule 6).
//
// Throw AppError with a code from services, actions and route handlers; runAction (src/lib/actions.ts) and the route
// helpers in src/lib/http.ts map it to { ok: false, error } or a JSON error response. Messages are user-facing copy
// (GEN-11: no em or en dashes); internals never leak (unexpected errors become "internal").
//
// Dependency free and client safe (client components may switch on error codes).

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "rate_limited",
  "slot_unavailable",
  "payment_required",
  "verification_required",
  "setup_required",
  "not_configured",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default HTTP status per code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  slot_unavailable: 409,
  payment_required: 402,
  verification_required: 403,
  setup_required: 503,
  not_configured: 501,
  internal: 500,
};

/** Default user-facing message per code. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Please log in to continue.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you were looking for.",
  validation: "Check the highlighted fields and try again.",
  conflict: "This was changed by someone else. Refresh and try again.",
  rate_limited: "Too many attempts. Try again later.",
  slot_unavailable: "That time is no longer available. Please choose another time.",
  payment_required: "Payment is required to complete this booking.",
  verification_required: "Verify your email address to continue.",
  setup_required: "Finish setting up the app: a database is required.",
  not_configured: "This feature is not configured on this server.",
  internal: "Something went wrong. Try again.",
};

export type FieldErrors = Record<string, string[]>;

export type AppErrorOptions = {
  /** Overrides the default HTTP status of the code. */
  status?: number;
  /** User-facing message (defaults to ERROR_MESSAGES[code]). */
  message?: string;
  /** Per-field messages for forms (keys are dotted input paths). */
  fieldErrors?: FieldErrors;
  /** Extra, safe-to-expose data (for example { retryAfterSeconds }). */
  details?: Record<string, unknown>;
  cause?: unknown;
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * An expected, user-facing failure.
 *
 *   throw new AppError("forbidden");
 *   throw new AppError("conflict", "This URL is not available.", { fieldErrors: { slug: ["This URL is not available."] } });
 *   throw new AppError("rate_limited", 429);          // a number as the second argument sets the status
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, messageOrStatus?: string | number | AppErrorOptions, opts: AppErrorOptions = {}) {
    const o: AppErrorOptions =
      typeof messageOrStatus === "object" && messageOrStatus !== null
        ? { ...messageOrStatus, ...opts }
        : typeof messageOrStatus === "number"
          ? { ...opts, status: messageOrStatus }
          : { ...opts, message: messageOrStatus ?? opts.message };
    super(o.message ?? ERROR_MESSAGES[code], o.cause === undefined ? undefined : { cause: o.cause });
    this.name = "AppError";
    this.code = code;
    this.status = o.status ?? ERROR_STATUS[code];
    if (o.fieldErrors) this.fieldErrors = o.fieldErrors;
    if (o.details) this.details = o.details;
  }

  /** Plain, serializable shape (ActionError, JSON bodies). */
  toJSON(): { code: ErrorCode; message: string; fieldErrors?: FieldErrors; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  if (e instanceof AppError) return true;
  // Tolerate duplicated module instances (Next dev, route bundles) by shape.
  const x = e as { name?: unknown; code?: unknown; status?: unknown } | null;
  return Boolean(x && x.name === "AppError" && isErrorCode(x.code) && typeof x.status === "number");
}

/**
 * Normalizes any thrown value to an AppError: AppErrors pass through, the database SetupRequiredError (code
 * "setup_required") maps to setup_required, everything else becomes "internal" with the generic message.
 */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "setup_required") return new AppError("setup_required", { cause: e });
  return new AppError("internal", { cause: e });
}

/** True when the error is not an expected AppError (and should be logged). */
export function isUnexpectedError(e: unknown): boolean {
  const app = toAppError(e);
  return app.code === "internal";
}

// Small constructors for the common cases.
export const unauthorizedError = (message?: string) => new AppError("unauthorized", message);
export const forbiddenError = (message?: string) => new AppError("forbidden", message);
export const notFoundError = (message?: string) => new AppError("not_found", message);
export const conflictError = (message?: string, fieldErrors?: FieldErrors) =>
  new AppError("conflict", message, fieldErrors ? { fieldErrors } : {});
export const notConfiguredError = (feature?: string) =>
  new AppError("not_configured", feature ? `${feature} is not configured on this server.` : undefined);
export const validationError = (fieldErrors: FieldErrors, message?: string) =>
  new AppError("validation", message, { fieldErrors });

/** Returns the value, or throws AppError("not_found") when it is null or undefined. */
export function orNotFound<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw notFoundError(message);
  return value;
}
