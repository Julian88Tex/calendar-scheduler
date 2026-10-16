// Request metadata for auth flows (audit entries, rate limit keys, session rows): client IP and user agent from the
// current Server Action or Route Handler request. Outside a request (jobs, scripts, tests) both are null.
import "server-only";
import { getClientIp, getUserAgent } from "@/lib/http";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** IP and user agent of a Route Handler request. */
export function requestMetaFrom(request: Request | Headers): RequestMeta {
  return { ip: getClientIp(request), userAgent: getUserAgent(request) };
}

/** IP and user agent of the current request (next/headers), or nulls outside a request scope. */
export async function currentRequestMeta(): Promise<RequestMeta> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return requestMetaFrom(new Headers(h));
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Runs `task` after the response is sent (next/server after()) so slow side effects (email delivery) neither delay
 * the response nor reveal through timing whether an account exists. Outside a request scope (tests, scripts) the task
 * runs inline. Failures are logged by the caller's task, never thrown to the request.
 */
export async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  let scheduled = false;
  try {
    const { after } = await import("next/server");
    after(task);
    scheduled = true;
  } catch {
    scheduled = false;
  }
  if (!scheduled) await task();
}
