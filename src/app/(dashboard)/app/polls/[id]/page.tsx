// OWNER: polls-ui.
//
// /app/polls/{id}: the meeting poll results page (SPEC MP-16 to MP-18, MP-21, MP-25; research meeting-polls.md B6 to
// B8): Top times and Grid, the Book dialog, invitations, reminders, comments and activity. Opening it clears the "New"
// dot of the Meeting polls list (MP-26). Deep links: ?book={optionId} (from the "Book this time" email button) opens
// the Book dialog, ?duplicate=1 offers to duplicate. Unknown polls and polls the user doesn't host are 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ResultsView } from "@/components/polls/results/results-view";
import { loadResultsPage, resultsDeepLinks } from "@/components/polls/server/host";
import { getActorCtx } from "@/lib/authz";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One load per request for generateMetadata and the page (it also clears the "New" dot). */
const load = cache(async (id: string) => loadResultsPage(await getActorCtx(), id, {}));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id).catch(() => null);
  return { title: data ? `${data.data.poll.title} - Meeting poll` : "Meeting poll" };
}

export default async function MeetingPollPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const props = await load(id);
  if (!props) notFound();
  return <ResultsView key={id} {...props} {...resultsDeepLinks(props.data, sp)} />;
}
