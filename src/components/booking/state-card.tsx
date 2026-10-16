// BK-23 state cards (SPEC BK-23, ET-09, OO-04): unknown pages ("This page isn't available"), event types turned off,
// single-use links already used and expired links. Rendered inside PublicPageShell with the host's branding; the footer
// has "Cookie settings" and "Privacy Policy" like the booking card. Server and client safe.
import Link from "next/link";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { buttonClassName } from "@/components/ui/button";
import { Illustration } from "@/components/ui/illustration";
import { cn } from "@/lib/cn";
import { bt } from "./lib/t";

export type StateKind = "not_found" | "off" | "used" | "expired";

const COPY: Record<StateKind, { title: string; body: string }> = {
  not_found: { title: "states.notFoundTitle", body: "states.notFoundBody" },
  off: { title: "states.offTitle", body: "states.offBody" },
  used: { title: "states.usedTitle", body: "states.usedBody" },
  expired: { title: "states.expiredTitle", body: "states.expiredBody" },
};

export type StateCardProps = {
  kind: StateKind;
  hostName?: string | null;
  ribbon?: boolean;
  embed?: boolean;
  privacyUrl?: string | null;
  className?: string;
};

export function StateCard({ kind, hostName, ribbon = true, embed, privacyUrl, className }: StateCardProps) {
  const copy = COPY[kind];
  return (
    <PublicCard width="narrow" ribbon={ribbon} embed={embed} className={cn("min-[600px]:min-h-[360px]", className)}>
      <div className="flex flex-col items-center px-6 pt-12 pb-8 text-center" data-testid={`state-${kind}`}>
        <Illustration name={kind === "not_found" ? "not-found" : "calendar"} />
        {hostName && <p className="mt-6 text-[16px] font-semibold text-ink-2">{hostName}</p>}
        <h1 className="mt-3 max-w-[420px] text-[22px] leading-7 font-bold text-public-text">{bt(copy.title)}</h1>
        <p className="mt-3 max-w-[420px] text-[14px] leading-[22px] text-ink-2">{bt(copy.body)}</p>
        {kind === "not_found" && (
          <Link href="/" className={cn(buttonClassName({ variant: "primary", size: "lg" }), "mt-6 bg-brand hover:bg-brand hover:brightness-90")}>
            {bt("states.goHome")}
          </Link>
        )}
      </div>
      <div className="flex justify-center px-6 pb-6">
        <PublicFooterLinks showPrivacyPolicy privacyUrl={privacyUrl} />
      </div>
    </PublicCard>
  );
}
