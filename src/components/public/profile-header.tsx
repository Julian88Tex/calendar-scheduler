// OWNER: foundation-ui.
//
// ProfileHeader (SPEC BK-01, BK-02; owner reference .reference/profile.png): the top of a landing page: the avatar
// (64px circle, initials on #E7EDF6 without a photo), the host or team name as the page h1 (#476788, 600, 16px) and the
// welcome message (#476788, 14px, centered, 286px wide: in Figtree that breaks the default welcome message into the
// same three lines as the owner's page). Optional logo at the card's top-left (BR-05).
import { cn } from "@/lib/cn";
import { Avatar } from "../ui/avatar";

export type ProfileHeaderProps = {
  name: string;
  avatarUrl?: string | null;
  welcomeMessage?: string | null;
  /** Branding logo (BR-05), shown at the card's top-left. */
  logoUrl?: string | null;
  /** hide_landing_page_details=1 (BK-26). */
  hidden?: boolean;
  className?: string;
};

export function ProfileHeader({ name, avatarUrl, welcomeMessage, logoUrl, hidden, className }: ProfileHeaderProps) {
  if (hidden) return <h1 className="sr-only">{name}</h1>;
  return (
    <div className={cn("relative flex flex-col items-center px-6 pt-[26px] pb-[42px] text-center", className)}>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="mb-4 max-h-[60px] max-w-[160px] object-contain min-[650px]:absolute min-[650px]:top-[26px] min-[650px]:left-8 min-[650px]:mb-0" />
      )}
      <Avatar src={avatarUrl} name={name} alt="" size={64} />
      <h1 className="mt-[18px] text-[16px] leading-6 font-semibold break-words text-ink-2">{name}</h1>
      {welcomeMessage && (
        <p className="mt-[23px] max-w-[286px] text-[14px] leading-[21px] break-words whitespace-pre-line text-ink-2">{welcomeMessage}</p>
      )}
    </div>
  );
}
