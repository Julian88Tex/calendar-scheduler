// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SMS core public API (ARCHITECTURE section 13.4, SPEC NT-16, GEN-15): sendSms (Twilio REST or the SMS log, with
// opt-outs, unsupported countries and the anti pumping caps), opt-out helpers and delivery status callbacks for the
// workflows Twilio webhook, and verifyTwilioSignature.
import "server-only";

export {
  SMS_DAILY_CAP_PER_NUMBER,
  SMS_FAILURE_PAUSE_COUNT,
  SMS_MAX_ATTEMPTS,
  applySmsStatusCallback,
  isSmsOptedOut,
  recordSmsOptOut,
  removeSmsOptOut,
  retrySmsDelivery,
  sendSms,
  smsTransportName,
  sweepStuckSms,
  type SendSmsInput,
  type SendSmsResult,
  type SmsRow,
} from "./send";
export {
  SMS_BODY_MAX,
  UNSUPPORTED_SMS_PREFIXES,
  isUnsupportedSmsCountry,
  maskPhone,
  normalizePhone,
  smsKeyword,
  smsSegments,
  type SmsEncoding,
} from "./segments";
export { twilioSignature, verifyTwilioSignature, type TwilioParams } from "./twilio-signature";
