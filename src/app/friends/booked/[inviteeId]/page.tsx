// /friends/booked/{inviteeId}: confirmations of the old friends link; redirects to /booking/{inviteeId}?friends=1.
import type { Route } from "next";
import { permanentRedirect } from "next/navigation";

type Props = { params: Promise<{ inviteeId: string }> };

export default async function Page({ params }: Props) {
  const { inviteeId } = await params;
  permanentRedirect(`/booking/${encodeURIComponent(inviteeId)}?friends=1` as Route);
}
