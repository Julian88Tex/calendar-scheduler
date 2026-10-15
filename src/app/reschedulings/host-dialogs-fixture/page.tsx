// OWNER: lifecycle-ui.
//
// /reschedulings/host-dialogs-fixture: E2E-only fixture page of the host meeting dialogs (WORKPLAN lifecycle-ui
// acceptance "Host dialogs ... work from a test page against seeded meetings"). Answers 404 unless E2E test mode is on
// (never on Vercel, src/lib/env.ts isE2eMode); requires a signed-in user and lists the meetings that user organizes,
// newest start first, through loadHostMeetingSummary (manage access checked per meeting). The Meetings page
// (meetings-dashboard) mounts the same components. Outside E2E test mode even the metadata is the generic 404 one, so
// production never shows that a fixture exists (golden-path-qa).
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { scheduledEvents } from "@/db/schema";
import { loadHostMeetingSummary } from "@/components/lifecycle/server/host-meeting";
import type { HostMeetingSummary } from "@/components/lifecycle/types";
import { getActorCtx } from "@/lib/authz";
import { isE2eMode } from "@/lib/env";
import { now } from "@/lib/time/now";
import { HostDialogsFixture } from "./fixture";

// Decided per request: a build without E2E_TEST_MODE must not bake the 404 in for a later E2E `next start`.
export const dynamic = "force-dynamic";

const NOINDEX = { index: false, follow: false } as const;

export function generateMetadata(): Metadata {
  return isE2eMode() ? { title: "Host dialogs fixture", robots: NOINDEX } : { title: "Page not found", robots: NOINDEX };
}

export default async function Page() {
  if (!isE2eMode()) notFound();
  const actor = await getActorCtx();
  const db = await getDb();
  const rows = await db
    .select({ id: scheduledEvents.id })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.organizerUserId, actor.user.id))
    .orderBy(desc(scheduledEvents.startAt))
    .limit(20);
  const meetings = (await Promise.all(rows.map((r) => loadHostMeetingSummary(actor, r.id)))).filter((m): m is HostMeetingSummary => m !== null);
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-headline-3 text-ink">Host dialogs fixture</h1>
      {meetings.length === 0 ? <p className="text-body-md text-ink-2">No meetings.</p> : <HostDialogsFixture meetings={meetings} now={now().getTime()} />}
    </main>
  );
}
