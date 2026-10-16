// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// English "payments" namespace (ARCHITECTURE section 19): payment step, hold countdown and refund messages.
// English files define the key type; other locales are DeepPartial of it. Placeholders use {name}. Minimal keys until
// the owner adds every string.
const messages = {
  step: {
    continue: "Continue to payment",
    pay: "Pay {amount} and schedule",
    holdCountdown: "We are holding this time for {minutes} minutes.",
  },
  refund: { notice: "Your payment of {amount} was refunded." },
};

export default messages;
