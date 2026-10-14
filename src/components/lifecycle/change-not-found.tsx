// 404 of the invitee cancel and reschedule pages (SPEC CR-02, CR-03, GEN-08): unknown or malformed invitee ids show
// "This page isn't available" with "The link may be broken or the meeting may have been removed." on the public canvas,
// never a hint about which meetings exist. Server and client safe.
import Link from "next/link";
import { PublicCard } from "@/components/public/public-card";
import { buttonClassName } from "@/components/ui/button";
import { Illustration } from "@/components/ui/illustration";
import { cn } from "@/lib/cn";
import { lt } from "./lib/t";

export function ChangeNotFound() {
  return (
    <PublicCard width="narrow" ribbon={false} className="min-[600px]:min-h-[360px]">
      <div className="flex flex-col items-center px-6 pt-12 pb-10 text-center" data-testid="change-not-found">
        <Illustration name="not-found" />
        <h1 className="mt-6 max-w-[420px] text-[22px] leading-7 font-bold text-public-text">{lt("states.notFoundTitle")}</h1>
        <p className="mt-3 max-w-[420px] text-[14px] leading-[22px] text-ink-2">{lt("states.notFoundBody")}</p>
        <Link href="/" className={cn(buttonClassName({ variant: "primary", size: "lg" }), "mt-6")}>
          {lt("states.goHome")}
        </Link>
      </div>
    </PublicCard>
  );
}
