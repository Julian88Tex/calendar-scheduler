// Gmail API answers mapped to outcomes (src/lib/email/gmail-transport.ts): credentials (401, missing scope) go to the
// connection helpers for a refresh or a reconnect; rate and daily limits, 5xx and a disabled API are retryable (with
// Retry-After); other 4xx are permanent. Messages above 4 MB use the media upload endpoint; above 35 MB they fail
// without a request.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (_connectionId: string, fn: (ctx: { accessToken: string }) => Promise<unknown>) => fn({ accessToken: "token-1" }),
}));

const { ProviderAuthError } = await import("@/lib/calendars/providers/types");
const { deliverWithGmail, GmailApiError, gmailErrorFromResponse, GMAIL_UPLOAD_URL, parseRetryAfter } = await import("@/lib/email/gmail-transport");
const { mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { parseMime } = await import("./mime");
const { gmailError } = await import("./helpers");

afterEach(() => vi.unstubAllGlobals());

const sender = { ownerUserId: "u1", ownerName: "Jordan Lee", connectionId: "c1", address: "jordan.lee@gmail.com", connectionStatus: "active" as const };
const outgoing = (attachments: { filename: string; contentType: string; contentBase64: string }[] = []) => ({
  from: { name: null, address: "x@example.com" },
  to: ["sam@example.com"],
  cc: [],
  bcc: [],
  replyTo: null,
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  ics: null,
  attachments,
  headers: { "Auto-Submitted": "auto-generated" },
  idempotencyKey: "k",
  tags: [],
});

describe("parseRetryAfter", () => {
  it("reads delta seconds and HTTP dates, capped at 6 hours", () => {
    const now = Date.parse("2030-03-04T10:00:00Z");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Mon, 04 Mar 2030 10:05:00 GMT", now)).toBe(300_000);
    expect(parseRetryAfter("Mon, 04 Mar 2030 09:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("999999", now)).toBe(6 * 60 * 60 * 1000);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe("gmailErrorFromResponse", () => {
  const map = (res: Response) => gmailErrorFromResponse(res);

  it("401 asks the connection helpers to refresh; a missing scope asks for a reconnect", async () => {
    const unauthorized = await map(gmailError(401, "authError", "Invalid Credentials"));
    expect(unauthorized).toBeInstanceOf(ProviderAuthError);
    expect((unauthorized as InstanceType<typeof ProviderAuthError>).reason).toBe("unauthorized");
    const scope = await map(
      mockResponse(
        { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
        { status: 403 },
      ),
    );
    expect((scope as InstanceType<typeof ProviderAuthError>).reason).toBe("insufficient_scope");
  });

  it("rate and daily limits, 5xx and a disabled API are retryable; other 4xx are permanent", async () => {
    for (const res of [
      gmailError(429, "rateLimitExceeded", "Too many requests", { "Retry-After": "30" }),
      gmailError(403, "dailyLimitExceeded", "Daily sending quota exceeded"),
      gmailError(403, "userRateLimitExceeded", "User rate limit exceeded"),
      gmailError(500, "backendError", "Backend Error"),
      mockResponse({ error: { code: 403, message: "Gmail API has not been used", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, { status: 403 }),
      new Response("<html>Bad gateway</html>", { status: 502 }),
    ]) {
      const e = await map(res);
      expect(e).toBeInstanceOf(GmailApiError);
      expect((e as InstanceType<typeof GmailApiError>).retryable, `${res.status}`).toBe(true);
    }
    const limited = (await map(gmailError(429, "rateLimitExceeded", "Too many requests", { "Retry-After": "30" }))) as InstanceType<typeof GmailApiError>;
    expect(limited.retryAfterMs).toBe(30_000);
    const badGateway = (await map(new Response("oops", { status: 502 }))) as InstanceType<typeof GmailApiError>;
    expect(badGateway.message).toBe("gmail 502: Gmail answered 502");
    for (const res of [
      gmailError(400, "failedPrecondition", "Mail service not enabled"),
      gmailError(400, "invalidArgument", "Invalid To header"),
      gmailError(403, "domainPolicy", "The domain administrators have disabled Gmail apps."),
      gmailError(413, "uploadTooLarge", "Request too large"),
    ]) {
      const e = (await map(res)) as InstanceType<typeof GmailApiError>;
      expect(e).toBeInstanceOf(GmailApiError);
      expect(e.retryable, `${res.status}`).toBe(false);
      expect(e.message).toMatch(/^Gmail refused to send this email \(\d{3} \w+\): /);
    }
  });
});

describe("deliverWithGmail", () => {
  it("uses the media upload endpoint above 4 MB and refuses messages above 35 MB without a request", async () => {
    const bodies: { url: string; type: string | null; raw: string }[] = [];
    mockFetch({
      method: "POST",
      url: GMAIL_UPLOAD_URL,
      handler: (req) => {
        bodies.push({ url: req.url.toString(), type: req.headers.get("content-type"), raw: req.raw });
        return { id: "gm-big" };
      },
    });
    const five = Buffer.alloc(5 * 1024 * 1024, 7).toString("base64");
    const big = await deliverWithGmail(outgoing([{ filename: "big.bin", contentType: "application/octet-stream", contentBase64: five }]), sender, { messageId: "<m1@localhost>" });
    expect(big).toEqual({ ok: true, providerMessageId: "gm-big" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.type).toBe("message/rfc822");
    const parsed = parseMime(Buffer.from(bodies[0]!.raw, "utf8").toString("latin1"));
    expect(parsed.header("from")).toBe("Jordan Lee <jordan.lee@gmail.com>");
    expect(parsed.header("message-id")).toBe("<m1@localhost>");

    const huge = Buffer.alloc(36 * 1024 * 1024, 1).toString("base64");
    const tooLarge = await deliverWithGmail(outgoing([{ filename: "huge.bin", contentType: "application/octet-stream", contentBase64: huge }]), sender, { messageId: "<m2@localhost>" });
    expect(tooLarge).toMatchObject({ ok: false, retryable: false });
    expect(bodies).toHaveLength(1);
  });

  it("maps a network failure to a retryable result and never throws", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const r = await deliverWithGmail(outgoing(), sender, { messageId: "<m3@localhost>" });
    expect(r).toEqual({ ok: false, retryable: true, error: "Could not reach Gmail: fetch failed" });
  });
});
