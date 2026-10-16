// OWNER: polls-ui.
//
// /app/polls/new: create a meeting poll (SPEC MP-01 to MP-05; research meeting-polls.md B3): the full-screen wizard
// "Choose times to offer" -> "Meeting details" -> "Your meeting poll is ready". Reached from "+ Create" > "Meeting poll"
// and the Meeting polls tab.
import type { Metadata } from "next";
import { loadCreateWizard } from "@/components/polls/server/host";
import { PollWizard } from "@/components/polls/wizard/poll-wizard";
import { getActorCtx } from "@/lib/authz";

export const metadata: Metadata = { title: "New meeting poll" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateAMeetingPollPage({ searchParams }: Props) {
  await searchParams;
  const actor = await getActorCtx();
  const props = await loadCreateWizard(actor);
  return <PollWizard {...props} />;
}
