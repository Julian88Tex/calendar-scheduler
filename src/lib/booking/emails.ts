// Booking-core emails: the 6-digit verification code (BK-17). Copy (our choice, Calendly style):
//   Subject: "{code} is your verification code"
//   "To complete your booking of {Event} with {Host}, enter this verification code:" / code / "This code expires in 10
//   minutes." / "If you didn't try to schedule a meeting, you can ignore this email."
import { emailPalette, renderEmail, type EmailBrand, type RenderedEmail } from "@/lib/email";

export function renderVerificationCodeEmail(p: {
  code: string;
  eventName: string;
  hostName: string;
  when: string | null;
  brand: EmailBrand;
}): RenderedEmail {
  const spaced = p.code.split("").join(" ");
  return renderEmail({
    subject: `${p.code} is your verification code`,
    preheader: `Your verification code is ${p.code}.`,
    heading: "Verify your email",
    brand: p.brand,
    reason: "You received this email because someone used this address to schedule a meeting.",
    blocks: [
      { kind: "text", text: `To complete your booking of ${p.eventName} with ${p.hostName}, enter this verification code:` },
      { kind: "html", html: `<p style="margin:0 0 16px 0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px;color:${emailPalette(p.brand).text}">${spaced}</p>`, text: p.code },
      ...(p.when ? [{ kind: "text" as const, text: p.when, muted: true }] : []),
      { kind: "text", text: "This code expires in 10 minutes.", small: true },
      { kind: "text", text: "If you didn't try to schedule a meeting, you can ignore this email.", muted: true, small: true },
    ],
  });
}
