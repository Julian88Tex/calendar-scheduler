// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "booking" namespace (ARCHITECTURE section 19): every booking page, confirmation and booking error string (booking-core returns codes only).
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  landing: { welcome: "Welcome to my scheduling page. Please follow the instructions to add an event to my calendar." },
  page: {
    selectDateTime: "Select a Date & Time",
    noTimes: "No times available",
    next: "Next",
    back: "Back",
  },
  details: {
    title: "Enter Details",
    name: "Name",
    email: "Email",
    addGuests: "Add Guests",
    schedule: "Schedule Event",
  },
  confirmation: { title: "You are scheduled", sentTo: "A calendar invitation has been sent to your email address." },
  errors: {
    slotUnavailable: "That time is no longer available. Please choose another time.",
    alreadyBooked: "You've already booked this time.",
    notFound: "This page could not be found.",
  },
};

export default messages;
