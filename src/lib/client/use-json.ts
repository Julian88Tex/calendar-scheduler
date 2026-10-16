// useJson (ARCHITECTURE section 20.2): a tiny fetch hook for JSON endpoints (slots, polls busy times, previews).
// Re-fetches when the URL (or the serializable init: method, headers, string body) changes, aborts stale requests,
// keeps the previous data while reloading, and surfaces the API error body ({ error, message }). Pass null to skip.
// Client components only.
import { useCallback, useEffect, useState } from "react";

export type JsonError = { status: number; code: string; message: string };

export type JsonState<T> = {
  data: T | null;
  error: JsonError | null;
  loading: boolean;
  /** Fetches again (keeps the current data while loading). */
  reload: () => void;
};

export type JsonInit = { method?: string; headers?: Record<string, string>; body?: string };

type Result<T> = { key: string; data: T | null; error: JsonError | null };

export function useJson<T>(url: string | null, init?: JsonInit): JsonState<T> {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const initKey = init ? JSON.stringify({ method: init.method, headers: init.headers, body: init.body }) : "";
  const key = url ? `${nonce}|${initKey}|${url}` : null;

  useEffect(() => {
    if (!url) return;
    const requestKey = `${nonce}|${initKey}|${url}`;
    const parsed = (initKey ? JSON.parse(initKey) : {}) as JsonInit;
    const controller = new AbortController();
    fetch(url, {
      method: parsed.method,
      body: parsed.body,
      signal: controller.signal,
      headers: { accept: "application/json", ...parsed.headers },
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as unknown;
        if (controller.signal.aborted) return;
        if (!res.ok) {
          const b = (body ?? {}) as { error?: string; message?: string };
          setResult((prev) => ({
            key: requestKey,
            data: prev?.data ?? null,
            error: { status: res.status, code: b.error ?? "internal", message: b.message ?? "Something went wrong. Try again." },
          }));
          return;
        }
        setResult({ key: requestKey, data: body as T, error: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || (e as { name?: string })?.name === "AbortError") return;
        setResult((prev) => ({
          key: requestKey,
          data: prev?.data ?? null,
          error: { status: 0, code: "network", message: "Check your connection and try again." },
        }));
      });
    return () => controller.abort();
  }, [url, nonce, initKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: url ? (result?.data ?? null) : null,
    error: url && result?.key === key ? result.error : null,
    loading: key !== null && result?.key !== key,
    reload,
  };
}
