// OWNER: polls-ui.
//
// /app/scheduling/meeting-polls: the Meeting polls tab of Scheduling (SPEC MP-01, MP-26; research meeting-polls.md B13;
// walkthrough 5.6 and 12.3). The Scheduling layout renders the "Scheduling" header with "+ Create" and the tabs; this
// page loads the actor's polls (owned, co-hosted, or the organization's for admins) with the filters from the URL and
// streams a skeleton while they load.
import type { Metadata } from "next";
import { Suspense } from "react";
import { PollsListSkeleton } from "@/components/polls/list/polls-list-skeleton";
import { PollsListView } from "@/components/polls/list/polls-list-view";
import { loadPollsList, type SearchParams } from "@/components/polls/server/host";
import { getActorCtx } from "@/lib/authz";

export const metadata: Metadata = { title: "Meeting polls" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MeetingPollsPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<PollsListSkeleton />}>
      <PollsList sp={sp} />
    </Suspense>
  );
}

async function PollsList({ sp }: { sp: SearchParams }) {
  const actor = await getActorCtx();
  const props = await loadPollsList(actor, sp);
  return <PollsListView key={`${props.filter}|${props.q}|${props.hostedBy}`} {...props} />;
}
