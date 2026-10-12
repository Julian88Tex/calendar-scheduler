// OWNER: event-types-editor.
//
// /app/event-types/[id]: the event type editor (SPEC ET-14 to ET-29; ARCHITECTURE 17.1). Unknown ids, deleted types,
// one-off and poll types, and types of other organizations are 404. Viewers ("Can view", ET-31) get the read-only
// editor. ?section=limits (or any section id) opens and scrolls to that section, for links such as the Troubleshoot
// view's "Adjust limits under Limits and buffers".
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EventTypeEditor } from "@/components/event-types/editor/event-type-editor";
import { getActorCtx } from "@/lib/authz";
import { getEventTypeEditorData } from "@/lib/event-types";
import { parseEditorSection } from "@/lib/event-types/schemas";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { getEventTypeReminders } from "@/lib/workflows";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** One load per request for generateMetadata and the page (schedules, calendars and conferencing are not cheap). */
const loadEditorData = cache(async (id: string) => getEventTypeEditorData(await getActorCtx(), id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Edit event type" };
  const data = await loadEditorData(id).catch(() => null);
  return { title: data ? `${data.draft.name} - Edit event type` : "Edit event type" };
}

export default async function EditEventTypePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const actor = await getActorCtx();
  const data = await loadEditorData(id);
  if (!data) notFound();
  const reminders = await getEventTypeReminders(actor, id).catch((e: unknown) => {
    log.warn("event_types.reminders_preload_failed", { error: e });
    return null;
  });
  return <EventTypeEditor key={id} data={data} initialSection={parseEditorSection(sp.section)} remindersInitial={reminders} />;
}
