// OWNER: event-types-editor.
//
// /app/event-types/new?kind=one_on_one: the editor of a new event type with the ET-33 defaults (SPEC ET-02, ET-14,
// ET-33). Nothing is stored until "Save changes" (created on first save, then the URL becomes /app/event-types/{id}).
// docs/SCOPE.md builds one-on-one event types only, so every kind parameter opens the one-on-one editor.
import type { Metadata } from "next";
import { EventTypeEditor } from "@/components/event-types/editor/event-type-editor";
import { getActorCtx } from "@/lib/authz";
import { getNewEventTypeEditorData } from "@/lib/event-types";
import { parseEditorSection } from "@/lib/event-types/schemas";

export const metadata: Metadata = { title: "New event type" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewEventTypePage({ searchParams }: Props) {
  const sp = await searchParams;
  const actor = await getActorCtx();
  const data = await getNewEventTypeEditorData(actor);
  return <EventTypeEditor data={data} initialSection={parseEditorSection(sp.section)} />;
}
