// Settings > My Link (SPEC BR-08, GEN-02; walkthrough 18 "My Link"): the warning, the URL input with the static
// "{host}/" prefix, a live availability check while typing (green "Available", red "This URL is taken" or "This URL
// is not available.") and "Save changes" / "Cancel". Input is normalized as it is typed (lowercase, spaces become
// hyphens). After saving, the old link stops working at once; the new link can be copied.
"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { checkHandleAction, saveHandleAction } from "@/lib/settings/actions";
import { HANDLE_MESSAGES, localHandleCheck, sanitizeHandleInput, type HandleCheck } from "@/lib/settings/schemas";

export type LinkFormProps = {
  /** The current slug (null for an account without one). */
  slug: string | null;
  /** Canonical origin ("https://kairos.example.com"). */
  origin: string;
  /** Host shown as the static prefix ("kairos.example.com"). */
  host: string;
  appName: string;
};

const CHECK_DELAY_MS = 350;

type Status = HandleCheck | { slug: string; status: "checking"; message: string };

export function LinkForm({ slug: initialSlug, origin, host, appName }: LinkFormProps) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [current, setCurrent] = useState(initialSlug ?? "");
  const [value, setValue] = useState(initialSlug ?? "");
  const [remote, setRemote] = useState<HandleCheck | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const slug = sanitizeHandleInput(value);
  const dirty = slug !== current;
  const local = dirty ? localHandleCheck(slug) : null;
  const needsRemote = dirty && !local;

  useEffect(() => {
    if (!needsRemote) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let result: HandleCheck;
      try {
        const res = await checkHandleAction({ slug });
        result = res.ok ? res.data : { slug, status: "invalid", message: res.error.fieldErrors?.slug?.[0] ?? res.error.message };
      } catch {
        result = { slug, status: "invalid", message: "We couldn't check this URL. Try again." };
      }
      if (!cancelled) setRemote(result);
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, needsRemote]);

  const status: Status | null = !dirty
    ? null
    : (local ?? (remote?.slug === slug ? remote : { slug, status: "checking", message: "Checking availability..." }));

  const blocked = !dirty || pending || status?.status === "checking" || (status !== null && status.status !== "available");
  const problem = saveError ?? (status && status.status !== "available" && status.status !== "checking" && status.status !== "current" ? status.message : null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) {
      if (problem) inputRef.current?.focus();
      return;
    }
    setSaveError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof saveHandleAction>>;
      try {
        res = await saveHandleAction({ slug });
      } catch {
        setSaveError("Couldn't save your changes. Try again.");
        return;
      }
      if (!res.ok) {
        setSaveError(res.error.fieldErrors?.slug?.[0] ?? res.error.message);
        inputRef.current?.focus();
        return;
      }
      setCurrent(res.data.slug);
      setValue(res.data.slug);
      setRemote(null);
      toast.success("Changes saved", { description: res.data.url });
      router.refresh();
    });
  };

  const publicUrl = current ? `${origin}/${current}` : null;
  const statusId = `${id}-status`;

  return (
    <form noValidate onSubmit={submit} aria-label="My Link" className="flex min-w-0 flex-col gap-5">
      <Banner variant="warning" role="none">
        Changing your {appName} URL will mean that all of your copied links will no longer work and will need to be updated.
      </Banner>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-slug`} className="text-label text-ink">
          Your URL
        </label>
        <Input
          ref={inputRef}
          id={`${id}-slug`}
          name="slug"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={60}
          leftAddon={`${host}/`}
          value={value}
          invalid={Boolean(problem)}
          aria-describedby={statusId}
          onChange={(e) => {
            setSaveError(null);
            setValue(sanitizeHandleInput(e.target.value));
          }}
          className="max-w-[560px]"
        />
        <p id={statusId} aria-live="polite" className="min-h-5 text-body-sm">
          {saveError ? (
            <StatusLine tone="error">{saveError}</StatusLine>
          ) : status?.status === "checking" ? (
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <Spinner size="sm" decorative />
              {status.message}
            </span>
          ) : status?.status === "available" ? (
            <StatusLine tone="success">{HANDLE_MESSAGES.available}</StatusLine>
          ) : status ? (
            <StatusLine tone={status.status === "current" ? "neutral" : "error"}>{status.message}</StatusLine>
          ) : null}
        </p>
      </div>

      {publicUrl && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-pebble px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-label-sm text-ink-2">Your current link</p>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-body-md font-semibold text-primary-text hover:underline">
              {publicUrl}
            </a>
          </div>
          <CopyButton value={publicUrl} size="sm" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" loading={pending} disabled={blocked && !pending}>
          Save changes
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || pending}
          onClick={() => {
            setValue(current);
            setSaveError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StatusLine({ tone, children }: { tone: "success" | "error" | "neutral"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5 font-semibold",
        tone === "success" && "text-success-text",
        tone === "error" && "text-danger-text",
        tone === "neutral" && "font-normal text-ink-2",
      )}
    >
      {tone === "success" && <CheckCircle2 aria-hidden="true" className="mt-px size-3.5 shrink-0" />}
      {tone === "error" && <XCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />}
      <span>{children}</span>
    </span>
  );
}
