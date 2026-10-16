// POST /api/test/compare (E2E only): connects the browser to a fake Google calendar for the booking page compare,
// without Google. { email?, calendars: [{ id, name, color?, primary?, selected? }], busy: { [calendarId]: [{ start,
// end }] } } -> the compare cookie (src/lib/compare/session.ts). Call it through page.request so the browser keeps it.
import { appendCompareCookie, newCompareSession, type FakeCompareData } from "@/lib/compare/session";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

type Body = Partial<FakeCompareData> & { email?: string };

export const POST = withTestGuard(async (request) => {
  const body = await readJson<Body>(request);
  const fake: FakeCompareData = { calendars: body.calendars ?? [{ id: "primary", name: "Visitor", primary: true }], busy: body.busy ?? {} };
  const session = newCompareSession({ accessToken: "e2e-fake", email: body.email ?? "visitor@example.com", expiresAt: null, fake });
  return appendCompareCookie(testJson({ ok: true }), session);
});
