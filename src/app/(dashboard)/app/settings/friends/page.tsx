// /app/settings/friends, "Friends mode": the friends link ({host}/{handle}?friends=1, components/booking/lib/friends.ts)
// and the words friends see there: landing page greeting, note and sign-off, favorites chips, headings, friendly event
// names and the booking and confirmation lines (users.preferences.friends).
import type { Metadata } from "next";
import { loadFriendsContent } from "@/components/booking/server/friends";
import { FriendsSettings } from "@/components/settings/friends-settings";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { friendsEventTypes } from "@/lib/settings/friends";
import { appUrl } from "@/lib/url";

export const metadata: Metadata = { title: "Friends mode" };

export default async function FriendsModePage() {
  const { user } = await getActorCtx();
  const [content, eventTypes] = await Promise.all([loadFriendsContent(user.id), friendsEventTypes(user.id)]);
  const friendsUrl = user.slug ? `${appUrl()}/${user.slug}?friends=1` : null;
  return (
    <div className="flex max-w-3xl min-w-0 flex-col">
      <PageHeader title="Friends mode" description="A warmer version of your booking pages for the people you actually want to hang out with." />
      <FriendsSettings content={content} eventTypes={eventTypes} friendsUrl={friendsUrl} />
    </div>
  );
}
