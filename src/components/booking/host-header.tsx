// Host header of the booking page details panel (SPEC BK-03): one host (64px avatar and name), a team (team avatar and
// name), or a stack of up to 3 overlapping avatars with a "+n" circle and "Ana and 3 others". Server and client safe.
import { BookingHostName } from "@/components/public/booking-card";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { stackParts, type HostHeader } from "./lib/hosts";

export function HostHeaderView({ header, compact, className }: { header: HostHeader; compact?: boolean; className?: string }) {
  const size = compact ? 40 : 64;
  if (header.variant === "single" || header.variant === "team") {
    const name = header.variant === "single" ? header.person.name : header.name;
    const src = header.variant === "single" ? header.person.avatarUrl : header.avatarUrl;
    return (
      <div className={cn("flex flex-col max-[999px]:items-center", className)} data-testid="host-header">
        <Avatar src={src} name={name} alt="" size={size} />
        <BookingHostName className="mt-2">{name}</BookingHostName>
      </div>
    );
  }
  const { shown, more } = stackParts(header);
  const all = header.people.map((p) => p.name).join(", ");
  return (
    <div className={cn("flex flex-col max-[999px]:items-center", className)} data-testid="host-header">
      <span role="img" aria-label={all || undefined} className="inline-flex items-center">
        {shown.map((p, i) => (
          <Avatar key={p.id} src={p.avatarUrl} name={p.name} alt="" size={size} className={cn("ring-2 ring-white", i > 0 && "-ml-4")} />
        ))}
        {more > 0 && (
          <span
            data-testid="host-more"
            aria-hidden="true"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.3) }}
            className="-ml-4 inline-flex shrink-0 items-center justify-center rounded-full bg-mist leading-none font-semibold text-ink ring-2 ring-white"
          >
            +{more}
          </span>
        )}
      </span>
      {header.label && <BookingHostName className="mt-2">{header.label}</BookingHostName>}
    </div>
  );
}
