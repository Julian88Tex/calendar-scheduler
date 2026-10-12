// Request scope fakes for the settings integration tests: a cookie jar and request headers behind next/headers, a
// no-op next/cache, and test images. Test files wire them with
//   vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
//   vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);
// (the dynamic import resolves to this same module instance, so tests and mocks share the state).
import { vi } from "vitest";

export const jar = new Map<string, string>();
export const request = { headers: new Headers() };

export function resetRequest(headers: Record<string, string> = {}): void {
  jar.clear();
  request.headers = new Headers({
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "x-forwarded-for": "203.0.113.9",
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

/**
 * Bytes that pass the server's image checks (magic bytes and the IHDR dimensions) without being a decodable picture:
 * the server never decodes images (no native modules), the browser resizes before uploading.
 */
export function fakePng(width: number, height: number, padBytes = 0): Uint8Array<ArrayBuffer> {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // RGBA
  return new Uint8Array(Buffer.concat([signature, ihdr, Buffer.alloc(padBytes)]));
}
