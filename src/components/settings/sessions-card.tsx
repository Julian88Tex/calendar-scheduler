// Settings > Login and security, "Active sessions" (SPEC BR-10, AU-05): every browser and device where the account is
// logged in (device and browser, IP address, last active and sign-in dates in the profile time zone), this device
// first and marked. "Log out" ends one other session at once; "Log out of all other sessions" asks first. Only the
// user's own sessions can be ended (checked on the server).
"use client";

import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/lib/settings/actions";
import type { DeviceKind, SessionListItem } from "@/lib/settings/schemas";

export type SessionsCardProps = {
  sessions: SessionListItem[];
  /** The profile time zone (dates are shown in it). */
  timezone: string;
  /** Server time, so "today" matches the server render. */
  nowIso: string;
};

const DEVICE_ICON: Record<DeviceKind, typeof Monitor> = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

function dayKey(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "Oct 12, 2026" in the zone. */
export function formatSessionDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** "today", "yesterday" or "Oct 12, 2026" (sessions record activity once a day). */
export function lastActiveLabel(iso: string, zone: string, nowIso: string): string {
  const day = dayKey(iso, zone);
  if (day === dayKey(nowIso, zone)) return "today";
  const yesterday = new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (day === dayKey(yesterday, zone)) return "yesterday";
  return formatSessionDate(iso, zone);
}

export function SessionsCard({ sessions: initial, timezone, nowIso }: SessionsCardProps) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [sessions, setSessions] = useState(initial);
  const [ending, setEnding] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.filter((s) => !s.current);

  const endOne = async (s: SessionListItem) => {
    setEnding(s.id);
    try {
      const res = await revokeSessionAction({ sessionId: s.id });
      if (!res.ok && res.error.code !== "not_found") {
        toast.error(res.error.message);
        return;
      }
      setSessions((list) => list.filter((x) => x.id !== s.id));
      toast.success(res.ok ? `Logged out of ${s.label}` : res.error.message);
      router.refresh();
    } catch {
      toast.error("Couldn't log out of that session. Try again.");
    } finally {
      setEnding(null);
    }
  };

  return (
    <Card padding="none" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-8 sm:pb-5">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-title-md font-bold text-ink">
            Active sessions
          </h2>
          <p className="mt-1 max-w-xl text-body-md text-ink-2">
            These are the browsers and devices where you are logged in. If you don&apos;t recognize one, log out of it and change your password.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={others.length === 0} onClick={() => setConfirmAll(true)}>
          Log out of all other sessions
        </Button>
      </div>
      <ul aria-label="Active sessions" className="divide-y divide-line border-t border-line">
        {sessions.map((s) => {
          const Icon = DEVICE_ICON[s.device];
          return (
            <li key={s.id} aria-label={s.current ? `${s.label}, this device` : s.label} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-8">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mist text-ink-2">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-label text-ink">
                  {s.label}
                  {s.current && (
                    <Badge variant="success" size="sm">
                      This device
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-body-sm text-ink-2">
                  {[
                    s.ip ? `IP ${s.ip}` : null,
                    s.current ? "Active now" : `Last active ${lastActiveLabel(s.lastSeenAt, timezone, nowIso)}`,
                    `Logged in ${formatSessionDate(s.createdAt, timezone)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {!s.current && (
                <Button variant="tertiary" size="sm" loading={ending === s.id} disabled={ending !== null && ending !== s.id} onClick={() => void endOne(s)} aria-label={`Log out of ${s.label}`}>
                  Log out
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length === 0 && <p className="border-t border-line px-5 py-4 text-body-md text-ink-2 sm:px-8">You aren&apos;t logged in anywhere else.</p>}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Log out of all other sessions?"
        description="You will stay logged in on this device. Every other browser and device will need to log in again."
        confirmLabel="Log out"
        variant="destructive"
        onConfirm={async () => {
          const res = await revokeOtherSessionsAction();
          // ConfirmDialog keeps the dialog open and shows the message as a toast.
          if (!res.ok) throw new Error(res.error.message);
          setSessions((list) => list.filter((s) => s.current));
          toast.success(res.data.count === 1 ? "Logged out of 1 other session" : `Logged out of ${res.data.count} other sessions`);
          router.refresh();
        }}
      />
    </Card>
  );
}
