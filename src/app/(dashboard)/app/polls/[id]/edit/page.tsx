// OWNER: polls-ui.
//
// /app/polls/{id}/edit: edit a published meeting poll (SPEC MP-27; research meeting-polls.md B14): the same full-screen
// wizard over the poll's times and settings. Unknown polls, deleted polls and polls the user doesn't host are 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadEditWizard } from "@/components/polls/server/host";
import { PollWizard } from "@/components/polls/wizard/poll-wizard";
import { getActorCtx } from "@/lib/authz";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const load = cache(async (id: string) => loadEditWizard(await getActorCtx(), id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id).catch(() => null);
  return { title: data?.poll ? `${data.poll.title} - Edit meeting poll` : "Edit meeting poll" };
}

export default async function EditMeetingPollPage({ params, searchParams }: Props) {
  const [{ id }] = await Promise.all([params, searchParams]);
  const props = await load(id);
  if (!props) notFound();
  return <PollWizard key={id} {...props} />;
}
