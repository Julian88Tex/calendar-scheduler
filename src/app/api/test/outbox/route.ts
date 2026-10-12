// GET /api/test/outbox?to=<email>&limit=20&template=<name> (E2E only): latest emails (newest first) with the links
// found in their HTML and text, so tests can follow confirmation, cancel and reschedule links.
import { and, arrayContains, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { emailOutbox } from "@/db/schema";
import { testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

const LINK_RE = /https?:\/\/[^\s"'<>)]+/g;

function extractLinks(...bodies: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const body of bodies) {
    for (const m of (body ?? "").matchAll(LINK_RE)) out.add(m[0].replace(/&amp;/g, "&").replace(/[.,;]+$/, ""));
  }
  return [...out];
}

export const GET = withTestGuard(async (request) => {
  const url = new URL(request.url);
  const to = url.searchParams.get("to")?.trim().toLowerCase();
  const template = url.searchParams.get("template");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 200);
  const filters: SQL[] = [];
  if (to) filters.push(arrayContains(emailOutbox.toAddresses, [to]));
  if (template) filters.push(eq(emailOutbox.template, template));
  const db = await getDb();
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(emailOutbox.createdAt))
    .limit(limit);
  return testJson({
    emails: rows.map((r) => ({
      id: r.id,
      to: r.toAddresses,
      cc: r.ccAddresses,
      from: r.fromAddress,
      replyTo: r.replyTo,
      subject: r.subject,
      text: r.text,
      html: r.html,
      template: r.template,
      category: r.category,
      status: r.status,
      icsMethod: r.icsMethod,
      hasIcs: Boolean(r.ics),
      links: extractLinks(r.html, r.text),
      scheduledEventId: r.scheduledEventId,
      inviteeId: r.inviteeId,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});
