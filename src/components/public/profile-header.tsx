// OWNER: foundation-ui.
//
// ProfileHeader (SPEC BK-01, BK-02; owner reference .reference/profile.png): the top of a landing page: the avatar
// (65px circle, initials on #E7EDF6 without a photo), the host or team name as the page h1 (#476788, 650, 16px) and the
// welcome message (#476788, 14px, centered, 278px wide: in Figtree with the booking pages' -0.01em tracking that breaks
// the default welcome message into the same three lines as the owner's page). Optional logo at the card's top-left
// (BR-05).
import { cn } from "@/lib/cn";
import { Avatar } from "../ui/avatar";
import { PUBLIC_TEXT_TRACKING } from "./booking-card";

export type ProfileHeaderProps = {
  name: string;
  /** Page h1 instead of the name (a persona's greeting). */
  heading?: string | null;
  avatarUrl?: string | null;
  welcomeMessage?: string | null;
  /** Branding logo (BR-05), shown at the card's top-left. */
  logoUrl?: string | null;
  /** hide_landing_page_details=1 (BK-26). */
  hidden?: boolean;
  className?: string;
};

export function ProfileHeader({ name, heading, avatarUrl, welcomeMessage, logoUrl, hidden, className }: ProfileHeaderProps) {
  if (hidden) return <h1 className="sr-only">{heading || name}</h1>;
  return (
    <div className={cn("relative flex flex-col items-center px-6 pt-[25px] pb-[21px] text-center min-[650px]:pb-[41px]", className)}>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="mb-4 max-h-[60px] max-w-[160px] object-contain min-[650px]:absolute min-[650px]:top-[26px] min-[650px]:left-8 min-[650px]:mb-0" />
      )}
      <Avatar src={avatarUrl} name={name} alt="" size={65} />
      <h1 className="mt-[17px] text-[16px] leading-6 font-[650] break-words text-ink-2">{heading || name}</h1>
      {welcomeMessage && (
        <p className={cn("mt-6 max-w-[278px] text-[14px] leading-[21px] break-words whitespace-pre-line text-ink-2", PUBLIC_TEXT_TRACKING)}>{welcomeMessage}</p>
      )}
    </div>
  );
}
