// Loading state of /app/meetings (SPEC GEN-12): the page title and the list skeleton inside the dashboard shell.
import { MeetingsSkeleton } from "@/components/meetings/meetings-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { MEETINGS_COPY } from "@/lib/meetings/copy";

export default function MeetingsLoading() {
  return (
    <>
      <PageHeader title={MEETINGS_COPY.title} className="mb-2" />
      <MeetingsSkeleton />
    </>
  );
}
