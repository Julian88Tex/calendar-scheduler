// /app/settings/personas, "Personas": who the public pages speak to. Each persona has a link ({host}/{handle}?for={id};
// the default one is the plain link), a look (warm or classic) and the words of its landing page, booking form and
// confirmation (users.preferences.personas, lib/personas.ts). Which event types each persona sees, and their names for
// it, are set on the event types.
import type { Metadata } from "next";
import { loadPersonas } from "@/components/booking/server/personas";
import { PersonasSettings } from "@/components/settings/personas-settings";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { appUrl } from "@/lib/url";

export const metadata: Metadata = { title: "Personas" };

export default async function PersonasPage() {
  const { user } = await getActorCtx();
  const personas = await loadPersonas(user.id);
  const baseUrl = user.slug ? `${appUrl()}/${user.slug}` : null;
  return (
    <div className="flex max-w-3xl min-w-0 flex-col">
      <PageHeader title="Personas" description="Different versions of your booking pages for different people, each with its own link and words." />
      <PersonasSettings personas={personas} baseUrl={baseUrl} />
    </div>
  );
}
