// OWNER: settings-onboarding.
//
// /app/settings/profile (SPEC BR-01 to BR-04; walkthrough 18 "Profile"; docs/SCOPE.md item 14): the picture (upload
// with a square crop, stored at 256px, or remove), then Name, Welcome Message, Date Format, Time Format and Time Zone
// with "Save changes". The welcome message and picture show on the landing page; the formats and the zone apply to
// the dashboard and host emails.
import type { Metadata } from "next";
import { AvatarField } from "@/components/settings/avatar-field";
import { ProfileForm } from "@/components/settings/profile-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getActorCtx } from "@/lib/authz";
import { avatarUrlOf, profileFormValues } from "@/lib/settings";

export const metadata: Metadata = { title: "Profile" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfilePage({ searchParams }: Props) {
  const [actor] = await Promise.all([getActorCtx(), searchParams]);
  const { user } = actor;
  return (
    <div className="flex max-w-3xl min-w-0 flex-col">
      <PageHeader title="Profile" />
      <Card padding="lg" className="flex flex-col gap-8">
        <AvatarField initialUrl={avatarUrlOf(user)} />
        <ProfileForm initial={profileFormValues(user)} />
      </Card>
    </div>
  );
}
