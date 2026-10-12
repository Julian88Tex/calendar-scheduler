// POST /api/test/login { email } (E2E only): creates a session for that user and sets the `sid` cookie
// (src/lib/auth/session.ts). Answers 404 JSON when no live user has the email.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { readJson, testJson, withTestGuard } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const POST = withTestGuard(async (request) => {
  const body = await readJson<{ email?: string }>(request);
  const email = body.email?.trim().toLowerCase();
  if (!email) return testJson({ error: "validation", message: "Pass { email }" }, { status: 400 });
  const db = await getDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.emailNormalized, email), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return testJson({ error: "not_found", message: `No user with email ${email}` }, { status: 404 });
  const { sessionId, expiresAt } = await createSession(user.id);
  return testJson({ ok: true, userId: user.id, sessionId, expiresAt: expiresAt.toISOString() });
});
