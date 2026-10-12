// Contacts with emails.
import type { DbOrTx } from "@/db";
import { contactEmails, contacts } from "@/db/schema";
import { normalizeEmail, one, uniq } from "./_util";
import type { TestUser } from "./users";

export type ContactRow = typeof contacts.$inferSelect;

export async function createContact(
  db: DbOrTx,
  opts: {
    owner: TestUser;
    name?: string;
    emails?: string[];
    creationSource?: ContactRow["creationSource"];
    overrides?: Partial<typeof contacts.$inferInsert>;
  },
) {
  const emailList = opts.emails ?? [`${uniq("contact")}@example.com`];
  const contact = one(
    await db
      .insert(contacts)
      .values({
        ownerUserId: opts.owner.id,
        organizationId: opts.owner.organizationId,
        name: opts.name ?? "Test Contact",
        primaryEmail: emailList[0] ?? null,
        creationSource: opts.creationSource ?? "manual",
        ...opts.overrides,
      })
      .returning(),
    "contact",
  );
  const emails = emailList.length
    ? await db
        .insert(contactEmails)
        .values(
          emailList.map((e, i) => ({
            contactId: contact.id,
            ownerUserId: opts.owner.id,
            email: e,
            emailNormalized: normalizeEmail(e),
            isPrimary: i === 0,
          })),
        )
        .returning()
    : [];
  return { contact, emails };
}
