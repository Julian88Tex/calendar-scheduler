// Structured JSON logging (ARCHITECTURE section 21): one line per event, secrets and emails redacted.
//
//   log.info("booking.created", { scheduledEventId, inviteeId });
//   log.error("job.failed", { jobId, error: e });
//   const jobLog = log.child({ jobId });  jobLog.warn("retry", { attempt });
//
// Redaction: values under keys that look like secrets (token, secret, password, authorization, cookie, *_enc, *_hash,
// api keys, codes) become "[redacted]"; email addresses inside strings are masked (j***@example.com). LOG_LEVEL
// (debug, info, warn, error, silent; default info, warn under tests) filters output. Dependency free.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line. */
  child(fields: LogFields): Logger;
};

const ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || "").trim().toLowerCase();
  if (raw in ORDER) return ORDER[raw as LogLevel];
  return process.env.NODE_ENV === "test" ? ORDER.warn : ORDER.info;
}

const SECRET_KEY =
  /(password|passwd|^pass$|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|signature|credential|_enc$|Enc$|_hash$|Hash$|verification_?code|recovery_?code|^otp$|totp)/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Masks emails and bearer credentials inside a string. */
export function redactString(value: string): string {
  return value.replace(EMAIL, "$1***@$2").replace(BEARER, "$1 [redacted]");
}

function serializeError(e: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { name: e.name, message: redactString(e.message) };
  const code = (e as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (e.stack) out.stack = redactString(e.stack.split("\n").slice(0, 8).join("\n"));
  if (e.cause !== undefined && depth < 3) out.cause = redactValue(e.cause, depth + 1);
  return out;
}

/** Deep copy with secrets redacted (exported for tests). */
export function redactValue(value: unknown, depth = 0, key = ""): unknown {
  if (key && SECRET_KEY.test(key) && value !== null && value !== undefined && typeof value !== "boolean") {
    return "[redacted]";
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof Error) return serializeError(value, depth);
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  if (value instanceof Map) return redactValue(Object.fromEntries(value), depth + 1);
  if (value instanceof Set) return redactValue([...value], depth + 1);
  if (typeof value === "object") {
    if (typeof (value as { toJSON?: unknown }).toJSON === "function" && !(value instanceof Error)) {
      try {
        return redactValue((value as { toJSON: () => unknown }).toJSON(), depth + 1, key);
      } catch {
        return "[unserializable]";
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, depth + 1, k);
    return out;
  }
  if (typeof value === "function") return "[function]";
  return String(value);
}

function write(level: LogLevel, event: string, fields: LogFields | undefined, bound: LogFields): void {
  if (ORDER[level] < threshold()) return;
  const payload = redactValue({ ...bound, ...(fields ?? {}) }) as Record<string, unknown>;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function makeLogger(bound: LogFields): Logger {
  return {
    debug: (event, fields) => write("debug", event, fields, bound),
    info: (event, fields) => write("info", event, fields, bound),
    warn: (event, fields) => write("warn", event, fields, bound),
    error: (event, fields) => write("error", event, fields, bound),
    child: (fields) => makeLogger({ ...bound, ...fields }),
  };
}

/** The application logger. */
export const log: Logger = makeLogger({});

/** A short random id for correlating log lines of one request or job. */
export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
