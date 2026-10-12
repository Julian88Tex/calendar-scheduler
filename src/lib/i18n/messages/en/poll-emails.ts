// OWNER: polls-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "poll-emails" namespace (ARCHITECTURE section 19): poll emails.
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  invite: { subject: "{hostName} invited you to vote on times for {title}", vote: "Vote on times" },
  booked: { subject: "{title} is scheduled" },
  unsubscribe: "Unsubscribe",
};

export default messages;
