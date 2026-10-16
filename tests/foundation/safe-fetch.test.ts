// SSRF-safe fetch (ARCHITECTURE 18.9, SPEC GEN-08 acceptance).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SafeFetchError,
  createPinnedLookup,
  isBlockedAddress,
  normalizeFeedUrl,
  parseIPv6,
  pinnedFetch,
  resolveAndValidate,
  safeFetch,
  setSafeFetchTestHooks,
  type ResolvedAddress,
  type Transport,
} from "@/lib/net/safe-fetch";

const env = process.env as Record<string, string | undefined>;

const PUBLIC_V4 = "93.184.216.34";
const DNS: Record<string, ResolvedAddress[]> = {
  "public.example": [{ address: PUBLIC_V4, family: 4 }],
  "other.example": [{ address: "151.101.1.69", family: 4 }],
  "v6.example": [{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }],
  "rebind.example": [{ address: "127.0.0.1", family: 4 }],
  "mixed.example": [
    { address: PUBLIC_V4, family: 4 },
    { address: "10.0.0.5", family: 4 },
  ],
  "metadata.example": [{ address: "169.254.169.254", family: 4 }],
  "mapped.example": [{ address: "::ffff:192.168.1.1", family: 6 }],
  "lan-caldav.local": [{ address: "192.168.1.20", family: 4 }],
};
const resolver = async (host: string) => {
  const r = DNS[host];
  if (!r) throw new Error("ENOTFOUND");
  return r;
};

type Hop = { url: string; method: string; headers: Headers; addresses: ResolvedAddress[] };
function routes(table: Record<string, () => Response>): { transport: Transport; hops: Hop[] } {
  const hops: Hop[] = [];
  const transport: Transport = async (url, init, addresses) => {
    hops.push({ url: url.toString(), method: init.method ?? "GET", headers: new Headers(init.headers), addresses });
    const make = table[url.toString()];
    if (!make) return new Response("not found", { status: 404 });
    return make();
  };
  return { transport, hops };
}

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });

afterEach(() => {
  setSafeFetchTestHooks({});
  delete env.SAFE_FETCH_ALLOW_HOSTS;
  delete env.VERCEL;
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254",
    "169.254.1.1", "100.64.0.1", "100.100.100.200", "0.0.0.0", "224.0.0.1", "239.255.255.250", "255.255.255.255",
    "240.0.0.1", "192.0.2.10", "198.51.100.1", "203.0.113.9", "198.18.0.1", "168.63.129.16",
    "::1", "::", "fe80::1", "fe80::1%eth0", "fc00::1", "fd00:ec2::254", "fd12:3456::1", "ff02::1", "fec0::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:127.0.0.1]", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::127.0.0.1", "::ffff:0:127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "2002:7f00:1::1",
    "2002:a9fe:a9fe::1", "2001::1", "2001:db8::1", "100::1", "not-an-ip", "", "999.1.1.1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1",
    "169.253.1.1", "2606:4700:4700::1111", "2a00:1450:4001:830::200e", "::ffff:8.8.8.8", "64:ff9b::808:808",
    "2002:808:808::1",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("parses IPv6 forms", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("[2001:db8::8a2e:370:7334]")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334]);
    expect(parseIPv6("1.2.3.4")).toBeNull();
  });
});

describe("safeFetch validation", () => {
  it("rejects loopback, IPv4-mapped IPv6, link-local and metadata literals (GEN-08 acceptance)", async () => {
    setSafeFetchTestHooks({ resolver, transport: routes({}).transport });
    for (const url of [
      "https://127.0.0.1/feed.ics",
      "https://[::ffff:127.0.0.1]/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data/",
      "https://[fe80::1]/",
      "https://[fd00:ec2::254]/",
      "https://10.0.0.1/",
      "https://2130706433/", // decimal form of 127.0.0.1 (WHATWG URL normalizes it)
      "https://0x7f.0.0.1/",
    ]) {
      const err = await safeFetch(url).catch((e: unknown) => e);
      expect(err, url).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).code, url).toBe("blocked_address");
    }
  });

  it("rejects non-https schemes, credentials and garbage", async () => {
    setSafeFetchTestHooks({ resolver, transport: routes({}).transport });
    for (const url of ["http://public.example/", "ftp://public.example/", "file:///etc/passwd", "webcal://public.example/x.ics", "https://user:pw@public.example/", "not a url", "gopher://x"]) {
      const err = await safeFetch(url).catch((e: unknown) => e);
      expect((err as SafeFetchError).code, url).toBe("invalid_url");
    }
    expect(normalizeFeedUrl("webcal://public.example/x.ics")).toBe("https://public.example/x.ics");
    expect(normalizeFeedUrl("WEBCALS://public.example/x.ics")).toBe("https://public.example/x.ics");
  });

  it("rejects host names that resolve to any blocked address (DNS check)", async () => {
    setSafeFetchTestHooks({ resolver, transport: routes({}).transport });
    for (const host of ["rebind.example", "mixed.example", "metadata.example", "mapped.example"]) {
      const err = await safeFetch(`https://${host}/`).catch((e: unknown) => e);
      expect((err as SafeFetchError).code, host).toBe("blocked_address");
    }
    expect((await safeFetch("https://unknown.example/").catch((e: unknown) => e) as SafeFetchError).code).toBe("invalid_url");
  });

  it("passes only the validated addresses to the transport (pinning input)", async () => {
    const r = routes({ "https://public.example/a": () => new Response("ok") });
    setSafeFetchTestHooks({ resolver, transport: r.transport });
    const res = await safeFetch("https://public.example/a");
    expect(await res.text()).toBe("ok");
    expect(r.hops[0]!.addresses).toEqual([{ address: PUBLIC_V4, family: 4 }]);
    const v6 = routes({ "https://v6.example/": () => new Response("six") });
    setSafeFetchTestHooks({ resolver, transport: v6.transport });
    expect(await (await safeFetch("https://v6.example/")).text()).toBe("six");
  });

  it("SAFE_FETCH_ALLOW_HOSTS reaches a listed LAN host when self-hosted, and is ignored on Vercel", async () => {
    const r = routes({ "https://lan-caldav.local/dav": () => new Response("dav") });
    setSafeFetchTestHooks({ resolver, transport: r.transport });
    await expect(safeFetch("https://lan-caldav.local/dav")).rejects.toMatchObject({ code: "blocked_address" });
    env.SAFE_FETCH_ALLOW_HOSTS = "lan-caldav.local, other.host";
    expect(await (await safeFetch("https://lan-caldav.local/dav")).text()).toBe("dav");
    expect(r.hops.at(-1)!.addresses).toEqual([{ address: "192.168.1.20", family: 4 }]);
    env.VERCEL = "1";
    await expect(safeFetch("https://lan-caldav.local/dav")).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("allowHttpLocalhost only for localhost and never on Vercel", async () => {
    await expect(resolveAndValidate(new URL("http://localhost:3000/x"), { allowHttpLocalhost: true })).resolves.toBeTruthy();
    await expect(resolveAndValidate(new URL("http://public.example/x"), { allowHttpLocalhost: true })).rejects.toMatchObject({ code: "invalid_url" });
    await expect(resolveAndValidate(new URL("http://localhost:3000/x"))).rejects.toMatchObject({ code: "invalid_url" });
    env.VERCEL = "1";
    await expect(resolveAndValidate(new URL("http://localhost:3000/x"), { allowHttpLocalhost: true })).rejects.toMatchObject({ code: "invalid_url" });
  });
});

describe("safeFetch redirects", () => {
  it("rejects a public host that redirects to a private or metadata address (every hop re-validated)", async () => {
    for (const target of ["https://169.254.169.254/latest/meta-data/", "https://rebind.example/", "https://[::ffff:10.0.0.1]/", "http://public.example/"]) {
      const r = routes({ "https://public.example/feed": redirect(target) });
      setSafeFetchTestHooks({ resolver, transport: r.transport });
      const err = await safeFetch("https://public.example/feed").catch((e: unknown) => e);
      expect(err, target).toBeInstanceOf(SafeFetchError);
      expect(["blocked_address", "invalid_url"]).toContain((err as SafeFetchError).code);
      expect(r.hops).toHaveLength(1); // the private target is never requested
    }
  });

  it("follows relative redirects, switches 303 to GET, and reports the final url", async () => {
    const r = routes({
      "https://public.example/start": redirect("/next?x=1", 301),
      "https://public.example/next?x=1": redirect("https://other.example/final", 303),
      "https://other.example/final": () => new Response("done", { headers: { "content-type": "text/plain" } }),
    });
    setSafeFetchTestHooks({ resolver, transport: r.transport });
    const res = await safeFetch("https://public.example/start", {
      method: "POST",
      body: "payload",
      headers: { authorization: "Bearer secret", "content-type": "text/plain" },
    });
    expect(await res.text()).toBe("done");
    expect(res.url).toBe("https://other.example/final");
    expect(res.redirected).toBe(true);
    expect(r.hops.map((h) => h.method)).toEqual(["POST", "GET", "GET"]);
    // Credentials are dropped when the redirect leaves the site.
    expect(r.hops[1]!.headers.get("authorization")).toBe("Bearer secret");
    expect(r.hops[2]!.headers.get("authorization")).toBeNull();
  });

  it("stops after maxRedirects and returns the 3xx itself when maxRedirects is 0 (webhooks)", async () => {
    const loop: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) loop[`https://public.example/${i}`] = redirect(`/${i + 1}`);
    setSafeFetchTestHooks({ resolver, transport: routes(loop).transport });
    await expect(safeFetch("https://public.example/0")).rejects.toMatchObject({ code: "too_many_redirects" });
    await expect(safeFetch("https://public.example/0", { maxRedirects: 2 })).rejects.toMatchObject({ code: "too_many_redirects" });
    const res = await safeFetch("https://public.example/0", { maxRedirects: 0 });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/1");
  });
});

describe("safeFetch limits", () => {
  it("rejects bodies over maxBytes by content-length and while streaming", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    const r = routes({
      "https://public.example/declared": () => new Response(big, { headers: { "content-length": String(big.length) } }),
      "https://public.example/stream": () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(1024 * 1024));
              c.close();
            },
          }),
        ),
      "https://public.example/small": () => new Response("x".repeat(100)),
    });
    setSafeFetchTestHooks({ resolver, transport: r.transport });
    await expect(safeFetch("https://public.example/declared")).rejects.toMatchObject({ code: "too_large" });
    await expect(safeFetch("https://public.example/stream")).rejects.toMatchObject({ code: "too_large" });
    await expect(safeFetch("https://public.example/small", { maxBytes: 50 })).rejects.toMatchObject({ code: "too_large" });
    expect((await (await safeFetch("https://public.example/small")).text()).length).toBe(100);
  });

  it("times out", async () => {
    const transport: Transport = (_url, _init, _addr, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    setSafeFetchTestHooks({ resolver, transport });
    await expect(safeFetch("https://public.example/slow", { timeoutMs: 50 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("connect-time pinning", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = http.createServer((req, res) => res.end(`pinned ${req.headers.host}`));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("createPinnedLookup answers with the validated addresses for any host name", async () => {
    const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
    const single = await new Promise<[string, number]>((resolve, reject) =>
      lookup("evil-rebind.example", {}, (err, address, family) => (err ? reject(err) : resolve([address as string, family as number]))),
    );
    expect(single).toEqual(["93.184.216.34", 4]);
    const all = await new Promise<unknown>((resolve, reject) =>
      lookup("evil-rebind.example", { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
    );
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("connects to the pinned IP without consulting DNS (an unresolvable host name still reaches it)", async () => {
    const ac = new AbortController();
    const res = await pinnedFetch(
      new URL(`http://pinned-host.invalid:${port}/`),
      { method: "GET" },
      [{ address: "127.0.0.1", family: 4 }],
      ac.signal,
    );
    expect(await res.text()).toBe(`pinned pinned-host.invalid:${port}`);
  });
});
