// Cloudflare Turnstile on the details form (SPEC BK-18): the script loads once on demand, every submission gets a fresh
// single-use token from a new "interaction-only" widget, and failures reject so the form can say so.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTurnstileRunner,
  loadTurnstile,
  resetTurnstileLoader,
  TURNSTILE_SCRIPT,
  type TurnstileApi,
  type TurnstileGlobals,
  type TurnstileRenderOptions,
} from "@/components/booking/lib/turnstile";

afterEach(() => {
  resetTurnstileLoader();
  vi.useRealTimers();
});

type FakeScript = { src: string; async: boolean; defer: boolean; onload: (() => void) | null; onerror: (() => void) | null; remove: () => void };

function fakeGlobals() {
  const scripts: FakeScript[] = [];
  const g = {
    window: {} as TurnstileGlobals["window"],
    document: {
      createElement: () => {
        const s: FakeScript = { src: "", async: false, defer: false, onload: null, onerror: null, remove: () => scripts.splice(scripts.indexOf(s), 1) };
        return s as unknown as HTMLScriptElement;
      },
      head: { appendChild: (s: FakeScript) => scripts.push(s) } as unknown as HTMLHeadElement,
    },
  } as TurnstileGlobals;
  return { g, scripts };
}

function fakeApi(behave: (o: TurnstileRenderOptions) => void) {
  const removed: string[] = [];
  const rendered: TurnstileRenderOptions[] = [];
  let n = 0;
  const api: TurnstileApi = {
    render: (_el, o) => {
      rendered.push(o);
      behave(o);
      return `w${++n}`;
    },
    remove: (id) => void removed.push(id),
  };
  return { api, removed, rendered };
}

const container = {} as HTMLElement;

describe("loadTurnstile", () => {
  it("adds the explicit-render script once and resolves with the API", async () => {
    const { g, scripts } = fakeGlobals();
    const first = loadTurnstile(g);
    const second = loadTurnstile(g);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ src: TURNSTILE_SCRIPT, async: true });
    const { api } = fakeApi(() => {});
    g.window.turnstile = api;
    scripts[0]!.onload!();
    expect(await first).toBe(api);
    expect(await second).toBe(api);
    expect(await loadTurnstile(g)).toBe(api);
  });

  it("can retry after the script failed to load", async () => {
    const { g, scripts } = fakeGlobals();
    const attempt = loadTurnstile(g);
    scripts[0]!.onerror!();
    await expect(attempt).rejects.toThrow("turnstile_load_failed");
    expect(scripts).toHaveLength(0);
    void loadTurnstile(g).catch(() => {});
    expect(scripts).toHaveLength(1);
  });
});

describe("createTurnstileRunner", () => {
  it("renders a fresh invisible widget per submission and resolves with its token", async () => {
    const { api, removed, rendered } = fakeApi((o) => o.callback(`token-${rendered.length}`));
    const runner = createTurnstileRunner("site-key", async () => api);
    expect(await runner.token(container)).toBe("token-1");
    expect(rendered[0]).toMatchObject({ sitekey: "site-key", appearance: "interaction-only", "response-field": false });
    // Tokens are single use: the second submission removes the old widget first.
    expect(await runner.token(container)).toBe("token-2");
    expect(removed).toEqual(["w1"]);
    runner.dispose();
    expect(removed).toEqual(["w1", "w2"]);
  });

  it("rejects on widget errors, expiry and missing containers", async () => {
    const failing = fakeApi((o) => o["error-callback"]());
    await expect(createTurnstileRunner("k", async () => failing.api).token(container)).rejects.toThrow("turnstile_failed");
    const expiring = fakeApi((o) => o["expired-callback"]());
    await expect(createTurnstileRunner("k", async () => expiring.api).token(container)).rejects.toThrow("turnstile_failed");
    await expect(createTurnstileRunner("k", async () => failing.api).token(null)).rejects.toThrow("turnstile_container_missing");
    await expect(createTurnstileRunner("k", async () => Promise.reject(new Error("offline"))).token(container)).rejects.toThrow("offline");
  });

  it("gives up when the challenge never answers", async () => {
    vi.useFakeTimers();
    const silent = fakeApi(() => {});
    const pending = createTurnstileRunner("k", async () => silent.api, 1_000).token(container);
    const assertion = expect(pending).rejects.toThrow("turnstile_failed");
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });
});
