// Cloudflare Turnstile on the details form (SPEC BK-18). When the instance sets TURNSTILE_SITE_KEY and
// TURNSTILE_SECRET_KEY, POST /api/public/bookings requires a Turnstile token, so the form runs the check on submit:
//
//   const runner = createTurnstileRunner(siteKey)
//   runner.preload()                 load the script once the details step shows (pages without a key never load it)
//   await runner.token(container)    a fresh single-use token: renders a new widget in the form's container with
//                                    "interaction-only" (invisible unless Cloudflare asks the visitor to click)
//   runner.dispose()                 removes the widget
//
// The script URL is fixed (render=explicit). Globals are injectable so the logic is testable without a browser.
// Client only.

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** A token request that neither succeeds nor fails (script hung, challenge left open) gives up after this long. */
export const TURNSTILE_TIMEOUT_MS = 120_000;

export type TurnstileRenderOptions = {
  sitekey: string;
  appearance: "interaction-only";
  /** The token goes into the JSON body, not a hidden form field. */
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  remove(widgetId: string): void;
};

export type TurnstileGlobals = {
  window: { turnstile?: TurnstileApi };
  document: Pick<Document, "createElement" | "head">;
};

let loading: Promise<TurnstileApi> | null = null;

function browserGlobals(): TurnstileGlobals {
  return { window: window as unknown as TurnstileGlobals["window"], document };
}

/** Loads the Turnstile script once per page (a failed load can be retried). */
export function loadTurnstile(g: TurnstileGlobals = browserGlobals()): Promise<TurnstileApi> {
  if (g.window.turnstile) return Promise.resolve(g.window.turnstile);
  if (loading) return loading;
  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const script = g.document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => (g.window.turnstile ? resolve(g.window.turnstile) : reject(new Error("turnstile_unavailable")));
    script.onerror = () => {
      script.remove();
      reject(new Error("turnstile_load_failed"));
    };
    g.document.head.appendChild(script);
  });
  loading = attempt.catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Test hook: forget the loaded script. */
export function resetTurnstileLoader(): void {
  loading = null;
}

export type TurnstileRunner = {
  preload(): void;
  token(container: HTMLElement | null): Promise<string>;
  dispose(): void;
};

export function createTurnstileRunner(
  siteKey: string,
  load: () => Promise<TurnstileApi> = () => loadTurnstile(),
  timeoutMs: number = TURNSTILE_TIMEOUT_MS,
): TurnstileRunner {
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;
  const removeWidget = () => {
    if (!api || !widgetId) return;
    try {
      api.remove(widgetId);
    } catch {
      // the widget is already gone
    }
    widgetId = null;
  };
  return {
    preload() {
      load().catch(() => {
        // retried on submit
      });
    },
    async token(container) {
      if (!container) throw new Error("turnstile_container_missing");
      api = await load();
      // Tokens are single use: every submission gets a fresh widget.
      removeWidget();
      const turnstile = api;
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => fail(), timeoutMs);
        function settle(fn: () => void) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        }
        function fail() {
          settle(() => reject(new Error("turnstile_failed")));
        }
        try {
          const id = turnstile.render(container, {
            sitekey: siteKey,
            appearance: "interaction-only",
            "response-field": false,
            callback: (token) => settle(() => (token ? resolve(token) : reject(new Error("turnstile_failed")))),
            "error-callback": () => {
              fail();
              return true; // handled: no console error from the widget
            },
            "expired-callback": fail,
            "timeout-callback": fail,
          });
          widgetId = typeof id === "string" ? id : null;
        } catch {
          fail();
        }
      });
    },
    dispose() {
      removeWidget();
    },
  };
}
