// Server Action results in poll client components: unwrap() returns the data or throws an ActionFailure carrying the
// action error (message and field errors), so dialogs can show field errors or let ConfirmDialog toast the message.
// Client and server safe.
import type { ActionError, ActionResult } from "@/lib/actions";

export class ActionFailure extends Error {
  readonly error: ActionError;
  constructor(error: ActionError) {
    super(error.message);
    this.name = "ActionFailure";
    this.error = error;
  }
}

export async function unwrap<T>(p: Promise<ActionResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ActionFailure(r.error);
  return r.data;
}

/** The user-facing message of a thrown value. */
export function failureMessage(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (e instanceof ActionFailure) return e.error.message || fallback;
  if (e instanceof Error && e.message && !/^(TypeError|Failed to fetch)/.test(e.message)) return e.message;
  return fallback;
}

export function fieldErrorsOf(e: unknown): Record<string, string[]> {
  return e instanceof ActionFailure ? (e.error.fieldErrors ?? {}) : {};
}
