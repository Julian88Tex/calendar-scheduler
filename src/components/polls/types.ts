// Page props of the meeting poll pages (polls-ui). Type only, client safe: the server loaders in ./server build these
// from polls-core's read models (src/lib/polls/types.ts) and the client components render them.
import type { LocationConfig } from "@/db/types";
import type { PublicBranding } from "@/components/public/public-page-shell";
import type { HostPollView, PollListItem, PollListFilter, PollHostedBy, VoterCalendarCheck, VoterPollView } from "@/lib/polls/types";

/** The signed-in user's display preferences. */
export type ViewerPrefs = { userId: string; name: string; email: string; avatarUrl: string | null; timezone: string; hour12: boolean; weekStart: 0 | 1; locale: string };

// ---------------------------------------------------------------------------------------------------------------
// Voter page (/p/{slug})

export type VoterPageProps = {
  slug: string;
  view: VoterPollView;
  /** The ?i= personal invite token (votes and comments tie to the invited participant). */
  inviteToken: string | null;
  /** Hidden bot check token (issuePollFormToken), refreshed with the page. */
  formToken: string;
  /** Cloudflare Turnstile site key when the instance requires it. */
  turnstileSiteKey: string | null;
  /** The voter's last "Check my calendar" result (browser cookie), if any. */
  calendarCheck: VoterCalendarCheck | null;
  flags: { calendarChecked: boolean; linkExpired: boolean; oauthError: string | null };
  /** The poll's results page for a signed-in host ("View live page" preview banner). */
  resultsHref: string | null;
  shell: VoterShell;
};

export type VoterShell = {
  branding: PublicBranding | null;
  logoUrl: string | null;
  ribbon: boolean;
  embed: boolean;
  hideGdprBanner: boolean;
  operatorEmail: string | null;
  privacyUrl: string | null;
};

// ---------------------------------------------------------------------------------------------------------------
// Meeting polls list (/app/scheduling/meeting-polls)

export type PollsListProps = {
  filter: PollListFilter;
  q: string;
  hostedBy: PollHostedBy;
  items: PollListItem[];
  nextCursor: string | null;
  /** Show the "Hosted by" filter (the organization has other people). */
  showHostedBy: boolean;
  viewer: ViewerPrefs;
};

// ---------------------------------------------------------------------------------------------------------------
// Create and edit wizard (/app/polls/new, /app/polls/{id}/edit)

export type HostOption = { userId: string; name: string; email: string; avatarUrl: string | null };

export type WizardProps = {
  mode: "create" | "edit";
  viewer: ViewerPrefs;
  /** Other people of the organization who can co-host. */
  members: HostOption[];
  /** Working hours start of the viewer's default schedule (minutes), for the first scroll position. */
  workingStartMinutes: number | null;
  /** Edit mode: the poll as it is. */
  poll: EditPollData | null;
};

export type EditPollData = {
  id: string;
  slug: string;
  link: string;
  status: HostPollView["poll"]["status"];
  title: string;
  descriptionHtml: string | null;
  location: LocationConfig | null;
  defaultDurationMinutes: number;
  settings: HostPollView["poll"]["settings"];
  options: HostPollView["options"];
  cohostIds: string[];
  respondentCount: number;
  /** A scheduled meeting exists (booked, or reopened with its meeting kept): the location is locked. */
  meetingLocked: boolean;
  canRemoveCohosts: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// Results page (/app/polls/{id})

export type ResultsPageProps = {
  data: HostPollView;
  viewer: ViewerPrefs;
  /** ?book={optionId}: open the Book dialog for that option. */
  bookOptionId: string | null;
  /** ?duplicate=1: offer to duplicate the poll. */
  offerDuplicate: boolean;
};
