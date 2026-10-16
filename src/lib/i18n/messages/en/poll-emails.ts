// OWNER: polls-core.
//
// English "poll-emails" namespace (ARCHITECTURE section 19; SPEC MP-23, research meeting-polls.md B10): every meeting
// poll email. English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. The
// subject of "vote received" is Calendly's observed subject; GEN-11: no em or en dashes.
const messages = {
  common: {
    viewResults: "View results",
    viewPoll: "View the poll",
    voteOnTimes: "Vote on times",
    updateResponse: "Update your response",
    reviewResponse: "Review or change your response",
    bookThisTime: "Book this time",
    bookNow: "Book now",
    viewMeeting: "View meeting",
    unsubscribe: "Unsubscribe from this poll",
    duration: "Duration",
    location: "Location",
    times: "Proposed times",
    votingCloses: "Voting closes",
    varies: "Varies",
    timesCount: "{count} proposed times",
    timesCountOne: "1 proposed time",
    moreTimes: "and {count} more",
    timesIn: "Times are shown in {zone}.",
    yes: "Yes",
    ifNeedBe: "If need be",
    no: "No",
    countsLine: "{yes} Yes, {ifNeedBe} If need be",
    responded: "{count} of {total} responded",
    respondedCount: "{count} responses",
    respondedCountOne: "1 response",
    topTimes: "Top times",
    noAnswers: "No responses yet.",
    allDay: "All day",
    reasonInvited: "You received this email because {hostName} invited you to a meeting poll.",
    reasonVoted: "You received this email because you responded to a meeting poll by {hostName}.",
    reasonHost: "You received this email because you host this meeting poll.",
    location_google_conference: "Google Meet",
    location_microsoft_teams_conference: "Microsoft Teams",
    location_zoom_conference: "Zoom",
    location_jitsi_conference: "Jitsi Meet",
    location_webex_conference: "Webex",
    location_gotomeeting_conference: "GoTo Meeting",
    location_physical: "In person",
    location_custom: "Custom location",
    location_inbound_call: "Phone call",
    messageFrom: "Message from {hostName}",
  },
  invite: {
    subject: "{hostName} wants to find a time: {title}",
    greeting: "Hi {name},",
    intro: "{hostName} wants to find a time for {title}. Choose all the times that work for you.",
  },
  voteReceived: {
    subject: "{name} has voted in a poll for {title}",
    intro: "{name} shared their availability for {title}.",
    introChanged: "{name} updated their availability for {title}.",
    introDeclined: "{name} said none of the proposed times work for {title}.",
    answers: "Their answers",
    noneWork: "None of these work",
  },
  digest: {
    subject: "Your meeting poll activity",
    intro: "Here's what happened in your meeting polls in the last day.",
    pollLine: "{votes} new responses, {comments} new comments",
  },
  confirmation: {
    subject: "Thanks for voting: {title}",
    heading: "Thanks for voting!",
    intro: "You'll receive a calendar invitation when the host decides a final time from submitted votes.",
    yourTimes: "Your preferred times",
    declined: "You said none of these times work for you.",
    noTimes: "You didn't choose any times.",
  },
  othersVoted: {
    subject: "New responses in {title}",
    intro: "More people responded to {title}.",
  },
  comment: {
    subject: "New comment on {title}",
    intro: "{name} commented on {title}:",
  },
  reminder: {
    subject: "Reminder: {hostName} is waiting for your availability for {title}",
    intro: "{hostName} is still waiting for your availability for {title}.",
    deadline: "Voting closes {when}.",
  },
  updated: {
    subject: "New times were added to {title}",
    intro: "{hostName} added new times to {title}. Update your response so {hostName} knows if you can make it.",
    newTimes: "New times",
  },
  edited: {
    subject: "{hostName} updated your response in {title}",
    intro: "{hostName} updated your availability for {title}.",
  },
  addedOnBehalf: {
    subject: "{hostName} added your availability to {title}",
    intro: "{hostName} added your availability to the meeting poll {title}. You can review or change it.",
  },
  removed: {
    subject: "You were removed from {title}",
    intro: "{hostName} removed your response from the meeting poll {title}.",
  },
  votingClosed: {
    subject: "Voting closed: {title}",
    intro: "Voting for {title} has closed.",
    topTime: "Top time",
  },
  deadlineWarning: {
    subject: "Voting closes in 24 hours: {title}",
    intro: "Voting for {title} closes {when}. Not everyone has responded yet.",
    action: "Send a reminder",
  },
  ended: {
    subject: "Your meeting poll ended: {title}",
    intro: "Every proposed time for {title} has passed and no time was booked.",
    action: "Duplicate with new times",
  },
  reopened: {
    subject: "{hostName} reopened the poll for {title}",
    intro: "{hostName} reopened the poll for {title}, you can update your response.",
  },
  canceled: {
    subject: "{hostName} canceled the poll {title}",
    intro: "{hostName} canceled the meeting poll {title}. You don't need to respond.",
  },
  code: {
    subject: "{code} is your verification code",
    intro: "Enter this code to share your preferred times for {title}. It expires in 10 minutes.",
    ignore: "If you didn't request this code, you can ignore this email.",
  },
  editLink: {
    subject: "Your link to update your response: {title}",
    intro: "You've already voted in {title}. Use this link to review or change your response.",
    introInvited: "{hostName} invited you to {title}. Use your personal link to share your availability.",
  },
  timeChosen: {
    subject: "A time was chosen for {title}",
    intro: "{hostName} chose {when} for {title}.",
  },
  autoBooked: {
    subject: "We booked {title}",
    intro: "We booked {when} because everyone agreed.",
  },
  holds: {
    title: "Reserved: {title}",
    description: "Placeholder for meeting poll {link}. Will be removed when a time is booked.",
  },
};

export default messages;
