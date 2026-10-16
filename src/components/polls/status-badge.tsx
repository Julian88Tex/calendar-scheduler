// Poll status badge (SPEC MP-16: Open, Closed, Booked, Canceled, Expired). Server and client safe.
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { PollStatus } from "@/lib/polls/types";
import { pt } from "./lib/t";

const VARIANT: Record<PollStatus, BadgeVariant> = {
  open: "info",
  closed: "neutral",
  booked: "success",
  canceled: "danger",
  expired: "outline",
};

export function PollStatusBadge({ status, className }: { status: PollStatus; className?: string }) {
  return (
    <Badge variant={VARIANT[status]} className={className} data-testid="poll-status">
      {pt(`status.${status}`)}
    </Badge>
  );
}
