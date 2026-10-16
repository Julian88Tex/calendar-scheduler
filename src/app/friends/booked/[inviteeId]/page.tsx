// /friends/booked/{inviteeId}: confirmations of the old friends link; redirects to /booking/{inviteeId}?for=friends.
import type { Route } from "next";
import { permanentRedirect } from "next/navigation";

type Props = { params: Promise<{ inviteeId: string }> };

export default async function Page({ params }: Props) {
  const { inviteeId } = await params;
  permanentRedirect(`/booking/${encodeURIComponent(inviteeId)}?for=friends` as Route);
}
