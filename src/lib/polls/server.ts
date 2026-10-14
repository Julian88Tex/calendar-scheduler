// OWNER: polls-core.
//
// Server-side surface of meeting polls for polls-ui (Server Components, page loaders) and the /api/polls/** and
// /api/public/polls/** route handlers. Mutations from client components go through the Server Actions in
// ./actions.ts (same services). Pure helpers (ranking, state, display, grid, visibility, validation schemas, types,
// constants) are imported from their own files and are safe in client code; this barrel is server only.
//
// Reads
//   getVoterView(slug, { editToken, inviteToken, userId, viewer })   voter page data, 200 | 301 (canonical slug) | 404 | 410
//   readVoterCalendarCheck(slug, cookieValue)                         the voter's "Check my calendar" result (cookie)
//   getHostPoll(actor, pollId, { markViewed })                        results page (ranking, grid, participants, settings)
//   getPollActivity(actor, pollId, since)                             activity feed and live updates
//   listPolls(actor, { filter, q, hostedBy, cursor, limit })          /app/scheduling/meeting-polls
//   bookingPreview(actor, pollId, optionId)                           the Book dialog (invitees, conflicts)
//   getPollGridOverlay(actor, { start, end, hostIds, pollId })        creation grid busy overlay and working hours
//   exportPollCsv(actor, pollId, timezone?)                           "Export CSV"
//   checkSlugAvailable(actor, slug, pollId?)                          "Customize link"
//   getUnsubscribeContext(slug, token)                                /p/{slug}/unsubscribe page
//   readEditToken(request) / readEditTokenFromHeaders()              the voter's edit cookie (or embed fallback header)
//
// Writes (each authorizes the actor itself; throws AppError)
//   createPoll, duplicatePoll, updatePoll, addOptions, removeOptions, invitePeople, sendReminders, addParticipant,
//   updateParticipant, removeParticipant, setParticipantVotes, closeVoting, reopenVoting, reopenPoll, deletePoll,
//   clearHolds, retryHolds, bookPoll, addHostComment, deleteHostComment, markPollViewed;
//   public: submitVote, requestVoteCode, addPublicComment, deletePublicComment, unsubscribe, checkVoterCalendar.
import "server-only";

export { requirePollAccess, requirePollOwner } from "./access";
export { bookingPreview, bookPoll } from "./book";
export { addHostComment, addPublicComment, deleteHostComment, deletePublicComment } from "./comments";
export { createPoll, duplicatePoll, isPollSlugAvailable, type CreatedPoll } from "./create";
export { appendCheckCookie, clearCheckCookie, readCheckCookie, readCheckCookieFromHeaders } from "./freebusy";
export { getUnsubscribeContext, invitePeople, sendReminders, unsubscribe, type InviteResult, type RemindResult, type UnsubscribeContext } from "./invites";
export { clearHolds, closeVoting, deletePoll, reopenPoll, reopenVoting, retryHolds } from "./manage";
export { getPollGridOverlay, type OverlayBlock, type PollGridOverlay } from "./overlay";
export {
  exportPollCsv,
  getBookedMeetingIcs,
  getHostPoll,
  getPollActivity,
  getVoterView,
  listMeetingPollsForApi,
  listPollEventTypesForApi,
  listPolls,
  type PollEventTypeApiRow,
  type VoterViewResult,
} from "./queries";
export { appendEditCookie, editCookiePaths, readEditToken, readEditTokenFromHeaders, setEditCookie } from "./tokens";
export {
  addOptions,
  checkSlugAvailable,
  removeOptions,
  updatePoll,
  type AddOptionsResult,
  type RemoveOptionsResult,
  type UpdatePollResult,
} from "./update";
export { checkVoterCalendar, readVoterCalendarCheck } from "./voter-calendar";
export {
  addParticipant,
  markPollViewed,
  removeParticipant,
  requestVoteCode,
  setParticipantVotes,
  submitVote,
  updateParticipant,
  verifyEditLink,
  type SubmitVoteContext,
  type VoterIdentity,
} from "./vote";
