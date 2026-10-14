// OWNER: meetings-dashboard.
//
// /app/meetings (ARCHITECTURE section 3.1; SPEC MT-01 to MT-15, CR-06 to CR-08, CR-11, CR-13, CR-14; walkthrough
// 10.1; docs/SCOPE.md): the "Meetings" page of the signed-in user. The URL query holds the tab, filters, page and the
// expanded meeting (?event={id}, also the target of the "View event" links in host emails); the read model is
// loadMeetingsPage (src/lib/meetings/queries.ts) and the view MeetingsView (src/components/meetings).
import type { Metadata } from "next";
import { MeetingsView } from "@/components/meetings/meetings-view";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { MEETINGS_COPY } from "@/lib/meetings/copy";
import { parseMeetingsQuery } from "@/lib/meetings/filters";
import { loadMeetingsPage } from "@/lib/meetings/queries";

export const metadata: Metadata = { title: "Meetings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MeetingsPage({ searchParams }: Props) {
  const query = parseMeetingsQuery(await searchParams);
  const actor = await getActorCtx();
  const data = await loadMeetingsPage(actor, query);
  return (
    <>
      <PageHeader title={MEETINGS_COPY.title} className="mb-2" />
      <MeetingsView data={data} />
    </>
  );
}
