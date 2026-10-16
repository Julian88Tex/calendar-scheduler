// Step 3, "Your meeting poll is ready" (SPEC MP-05; research B3.4): the link {APP_URL}/p/{slug} with "Edit link ending"
// (live availability check; the old link keeps redirecting for 90 days), "Copy link" (primary), "View live page" (the
// signed-in host sees the "Preview, your votes will not be saved" banner), "Invite people", "Copy times as text" (the
// options in the host's zone plus the link) and "Done" (to the results). Client component.
"use client";

import { CheckCircle2, ExternalLink, Link as LinkIcon, Pencil, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useCopy } from "@/lib/client/use-copy";
import { checkPollSlugAction, updatePollAction } from "@/lib/polls/actions";
import { timesAsText } from "@/lib/polls/display";
import { isValidPollSlug } from "@/lib/polls/validation";
import { POLL_ERRORS } from "@/lib/polls/constants";
import { friendlyZoneName } from "@/lib/time/zones";
import { InviteDialog } from "../dialogs/invite-dialog";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { sortOptions, type DraftOption } from "../lib/options";
import { pt } from "../lib/t";
import { asView } from "./times-sidebar";

export type SharePanelProps = {
  pollId: string;
  slug: string;
  link: string;
  title: string;
  options: DraftOption[];
  zone: string;
  hour12: boolean;
  hostName: string;
  onSlugChange: (slug: string, link: string) => void;
  onDone: () => void;
};

export function SharePanel(p: SharePanelProps) {
  const { copied, copy } = useCopy();
  const timesCopy = useCopy();
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(p.slug);
  const [check, setCheck] = useState<{ slug: string; available: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const prefix = p.link.slice(0, p.link.length - p.slug.length);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // "Share meeting poll" is gone once the poll exists: move focus to the new heading (screen readers hear the step).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const candidate = ending.trim().toLowerCase();
  const status: "idle" | "checking" | "available" | "taken" | "invalid" = !editing || candidate === p.slug
    ? "idle"
    : !isValidPollSlug(candidate)
      ? "invalid"
      : check?.slug === candidate
        ? check.available
          ? "available"
          : "taken"
        : "checking";

  useEffect(() => {
    if (!editing || candidate === p.slug || !isValidPollSlug(candidate)) return;
    let live = true;
    const t = setTimeout(() => {
      void checkPollSlugAction({ slug: candidate, pollId: p.pollId }).then((res) => {
        if (live && res.ok) setCheck({ slug: candidate, available: res.data.available });
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [candidate, editing, p.slug, p.pollId]);

  const saveEnding = async () => {
    const v = ending.trim().toLowerCase();
    if (v === p.slug) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const out = await unwrap(updatePollAction({ pollId: p.pollId, slug: v }));
      if (!out.done) return;
      p.onSlugChange(out.result.slug, `${prefix}${out.result.slug}`);
      setEditing(false);
      toast.success(pt("share.linkSaved"), { description: pt("share.linkRedirectHint") });
    } catch (e) {
      setError(fieldErrorsOf(e).slug?.[0] ?? failureMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const copyTimes = async () => {
    const text = timesAsText(sortOptions(p.options, p.zone).map(asView), { zone: p.zone, pollZone: p.zone, zoneLabel: friendlyZoneName(p.zone), link: p.link, hour12: p.hour12 });
    if (await timesCopy.copy(text)) toast.success(pt("share.timesCopied"));
  };

  const hint =
    status === "invalid" ? POLL_ERRORS.slugInvalid : status === "taken" ? POLL_ERRORS.slugTaken : status === "available" ? pt("share.linkAvailable") : status === "checking" ? pt("share.linkChecking") : null;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center px-4 py-10 text-center" data-testid="poll-share">
      <span aria-hidden="true" className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
        <CheckCircle2 className="size-8" />
      </span>
      <h2 ref={headingRef} className="mt-4 text-headline-3 text-ink outline-none" tabIndex={-1}>
        {pt("share.title")}
      </h2>
      <p className="mt-2 text-body text-ink-2">{pt("share.body")}</p>

      <div className="mt-8 w-full rounded-[var(--radius-card)] border border-line bg-white p-4 text-left">
        <p className="mb-2 text-label text-ink">{pt("share.linkLabel")}</p>
        {editing ? (
          <div className="flex flex-col gap-2">
            <Input
              aria-label={pt("share.linkEnding")}
              value={ending}
              onChange={(e) => setEnding(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              leftAddon={prefix.replace(/^https?:\/\//, "")}
              invalid={status === "invalid" || status === "taken" || Boolean(error)}
              maxLength={64}
            />
            {hint && (
              <p className={status === "available" ? "text-body-sm text-success-text" : status === "checking" ? "text-body-sm text-ink-2" : "text-body-sm text-danger-text"} role="status">
                {hint}
              </p>
            )}
            <FieldError error={error} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void saveEnding()} loading={saving} disabled={status === "invalid" || status === "taken" || status === "checking"}>
                {pt("common.save")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setEnding(p.slug);
                  setError(null);
                }}
              >
                {pt("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={p.link} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-body-md font-semibold text-primary-text hover:underline" data-testid="poll-link">
              {p.link}
            </a>
            <Button variant="tertiary" size="sm" leftIcon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(true)}>
              {pt("share.editLink")}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <Button
          leftIcon={<LinkIcon aria-hidden="true" className="size-4" />}
          onClick={async () => {
            if (await copy(p.link)) toast.success(pt("common.linkCopied"));
          }}
          data-testid="share-copy-link"
        >
          {copied ? pt("common.copied") : pt("common.copyLink")}
        </Button>
        <Button asChild variant="secondary" leftIcon={<ExternalLink aria-hidden="true" className="size-4" />}>
          <a href={p.link} target="_blank" rel="noopener noreferrer">
            {pt("share.viewLive")}
          </a>
        </Button>
        <Button variant="secondary" leftIcon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => setInviteOpen(true)}>
          {pt("share.invite")}
        </Button>
        <Button variant="secondary" onClick={() => void copyTimes()}>
          {timesCopy.copied ? pt("common.copied") : pt("share.copyTimes")}
        </Button>
      </div>
      <Button variant="tertiary" className="mt-8" onClick={p.onDone} data-testid="share-done">
        {pt("share.done")}
      </Button>
      {inviteOpen && <InviteDialog open onOpenChange={setInviteOpen} pollId={p.pollId} pollTitle={p.title} hostName={p.hostName} />}
    </div>
  );
}
