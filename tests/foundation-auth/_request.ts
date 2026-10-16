// Request scope fakes for foundation-auth integration tests: a cookie jar and request headers behind next/headers, and
// helpers to read Next redirect signals. Test files wire them with
//   vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
//   vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);
// (the dynamic import resolves to this same module instance, so tests and mocks share the state).
import { vi } from "vitest";

export type CookieSet = { name: string; value: string; opts: Record<string, unknown> };

export const jar = new Map<string, string>();
export const cookieSets: CookieSet[] = [];
export const request = { headers: new Headers() };

export function resetRequest(headers: Record<string, string> = {}): void {
  jar.clear();
  cookieSets.length = 0;
  request.headers = new Headers({
    "user-agent": "vitest",
    "x-forwarded-for": "203.0.113.7",
    host: "localhost:3000",
    ...headers,
  });
}

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, opts: Record<string, unknown> = {}) => {
      cookieSets.push({ name, value, opts });
      if (opts.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => request.headers,
};

export const nextCacheMock = {
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
};

/** The target of a thrown Next redirect() (digest "NEXT_REDIRECT;replace;/path;307;"), or null. */
export function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: string } | null)?.digest;
  if (!digest?.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? null;
}

/** Runs an action that should redirect and returns the target (fails the test when it does not redirect). */
export async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    const value = await p;
    throw new Error(`expected a redirect, got ${JSON.stringify(value)}`);
  } catch (e) {
    const target = redirectTarget(e);
    if (!target) throw e;
    return target;
  }
}

/** FormData from a plain object. */
export function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

/** The pathname and search of an absolute or relative Location. */
export function locationOf(res: Response): string {
  const loc = res.headers.get("location") ?? "";
  const u = new URL(loc, "http://localhost:3000");
  return `${u.pathname}${u.search}`;
}
