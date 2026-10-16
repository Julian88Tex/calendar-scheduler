// Personal section header of the Scheduling page (SPEC ET-03, walkthrough 5.1): the user's avatar (40px) and name
// (600), the public link "{host}/{slug}" as a blue link with a copy button, "View landing page" with the external icon
// and "Manage availability" (the Availability page holds the schedules these event types use). Client component.
"use client";

import { Clock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { CopyButton } from "@/components/ui/copy-button";

export type SchedulingProfile = {
  name: string;
  avatarUrl: string | null;
  /** Absolute landing page URL, null when the user has no link yet. */
  publicUrl: string | null;
  /** "kairos.example.com/julianjoseph". */
  linkLabel: string | null;
};

export function SectionHeader({ profile }: { profile: SchedulingProfile }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={profile.avatarUrl} name={profile.name} alt="" size={40} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-[16px] leading-6 font-semibold text-ink">{profile.name}</p>
          {profile.publicUrl && profile.linkLabel ? (
            <div className="flex min-w-0 items-center gap-1">
              <a
                href={profile.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate rounded-[2px] text-body-md text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {profile.linkLabel}
              </a>
              <CopyButton value={profile.publicUrl} iconOnly size="sm" variant="ghost" label="Copy your link" className="size-8 min-h-8 text-ink-2 max-sm:size-10 max-sm:min-h-10" />
            </div>
          ) : (
            <Link href="/app/settings/link" className="w-fit text-body-md font-semibold text-primary-text hover:underline">
              Choose your link
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[52px] sm:pl-0">
        <Link
          href="/app/availability"
          className="inline-flex items-center gap-1.5 rounded-full py-1 text-[14px] font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Clock aria-hidden="true" className="size-4" />
          Manage availability
        </Link>
        {profile.publicUrl && (
          <a
            href={profile.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full py-1 text-[14px] font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            View landing page
          </a>
        )}
      </div>
    </div>
  );
}
