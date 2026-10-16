// Settings > Branding (SPEC BR-05, BR-06; walkthrough 18 "Branding"; docs/SCOPE.md item 14): the "Logo" card (shown at
// the top of the booking page panel and in email headers), the "Use {AppName} branding" switch (off hides the Powered
// by ribbon on every public page and the footer in emails; saved at once) and a live preview of the booking page
// panel with the logo, or the picture when there is no logo, and the ribbon.
"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/brand";
import { removeImageAction, setShowBrandingAction } from "@/lib/settings/actions";
import { LogoUploader } from "./logo-uploader";

export type BrandingSettingsProps = {
  logoUrl: string | null;
  showBranding: boolean;
  /** For the preview: the host's name and picture and an event type name. */
  preview: { name: string; avatarUrl: string | null; eventName: string; durationLabel: string };
};

export function BrandingSettings({ logoUrl: initialLogo, showBranding: initialShow, preview }: BrandingSettingsProps) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [logoUrl, setLogoUrl] = useState(initialLogo);
  const [showBranding, setShowBranding] = useState(initialShow);
  const [savingBranding, setSavingBranding] = useState(false);

  const toggleBranding = async (next: boolean) => {
    const previous = showBranding;
    setShowBranding(next);
    setSavingBranding(true);
    try {
      const res = await setShowBrandingAction({ showBranding: next });
      if (!res.ok) {
        setShowBranding(previous);
        toast.error(res.error.message);
        return;
      }
      setShowBranding(res.data.showBranding);
      toast.success("Changes saved");
      router.refresh();
    } catch {
      setShowBranding(previous);
      toast.error("Couldn't save your changes. Try again.");
    } finally {
      setSavingBranding(false);
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card padding="lg" aria-labelledby={`${id}-logo`}>
          <h2 id={`${id}-logo`} className="text-title-md font-bold text-ink">
            Logo
          </h2>
          <p className="mt-1 mb-5 text-body-md text-ink-2">Your logo will appear on your booking pages and in notifications.</p>
          <LogoUploader
            value={logoUrl}
            onChange={(url) => {
              setLogoUrl(url);
              router.refresh();
            }}
            onRemove={async () => {
              try {
                const res = await removeImageAction({ kind: "logo" });
                if (!res.ok) return res.error.message;
              } catch {
                return "Couldn't remove the logo. Try again.";
              }
              setLogoUrl(null);
              router.refresh();
              return null;
            }}
          />
        </Card>

        <Card padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={`${id}-branding`} className="text-title-md font-bold text-ink">
                Use {APP_NAME} branding
              </h2>
              <p id={`${id}-branding-desc`} className="mt-1 max-w-xl text-body-md text-ink-2">
                Show the &quot;Powered by {APP_NAME}&quot; ribbon on your booking pages and the {APP_NAME} footer in the emails sent to your
                invitees. Turn it off to show only your own branding.
              </p>
            </div>
            <Switch
              checked={showBranding}
              disabled={savingBranding}
              onCheckedChange={(v) => void toggleBranding(v)}
              aria-labelledby={`${id}-branding`}
              aria-describedby={`${id}-branding-desc`}
              showStateLabel
              className="shrink-0"
            />
          </div>
        </Card>
      </div>

      <section aria-labelledby={`${id}-preview`} className="flex min-w-0 flex-col gap-3">
        <h2 id={`${id}-preview`} className="text-eyebrow text-ink-2">
          Preview
        </h2>
        <p className="sr-only">
          {logoUrl ? "Your booking pages show your logo at the top of the event details." : "Your booking pages show your picture at the top of the event details."}{" "}
          {showBranding ? `The Powered by ${APP_NAME} ribbon is shown.` : `The Powered by ${APP_NAME} ribbon is hidden.`}
        </p>
        <BookingPanelPreview logoUrl={logoUrl} showBranding={showBranding} {...preview} />
      </section>
    </div>
  );
}

/** A small, non-interactive picture of the booking page details panel (hidden from assistive technology). */
function BookingPanelPreview({
  logoUrl,
  showBranding,
  name,
  avatarUrl,
  eventName,
  durationLabel,
}: { logoUrl: string | null; showBranding: boolean } & BrandingSettingsProps["preview"]) {
  return (
    <div aria-hidden="true" data-testid="branding-preview" className="relative w-full max-w-[340px] rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
      {showBranding && (
        <span data-testid="branding-preview-ribbon" className="absolute -top-[5px] -right-[5px] z-10 block size-[84px] overflow-hidden">
          <span className="absolute top-0 left-0 size-1.5 bg-ribbon" />
          <span className="absolute right-0 bottom-0 size-1.5 bg-ribbon" />
          <span className="absolute top-[19px] -left-[13px] flex h-[26px] w-32 rotate-45 flex-col items-center justify-center bg-ribbon text-center text-white shadow-[0_2px_4px_0_rgb(0_0_0/20%)]">
            <span className="block text-[6px] leading-[8px] font-bold tracking-[0.4px] uppercase">Powered by</span>
            <span className="block max-w-[90px] truncate text-[11px] leading-[13px] font-bold">{APP_NAME}</span>
          </span>
        </span>
      )}
      <div className="flex justify-center border-b border-line px-6 pt-5 pb-5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="max-h-[80px] max-w-[160px] object-contain" />
        ) : (
          <Avatar src={avatarUrl} name={name} alt="" size={80} />
        )}
      </div>
      <div className="flex flex-col gap-1 px-6 pt-4 pb-6">
        <span className="text-[13px] leading-5 font-bold text-ink-2">{name}</span>
        <span className="text-[20px] leading-6 font-bold break-words text-ink">{eventName}</span>
        <span className="mt-2 flex items-center gap-2 text-[13px] leading-5 font-semibold text-ink-2">
          <Clock className="size-4 text-navy" />
          {durationLabel}
        </span>
      </div>
    </div>
  );
}
