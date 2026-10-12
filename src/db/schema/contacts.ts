// ARCHITECTURE section 5.4.15: contacts (per owner), emails, notes, reminders, custom fields and lists.
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { invitees } from "./bookings.ts";
import { singleUseLinks } from "./links.ts";

export const contactSource = pgEnum("contact_source", ["booking", "manual", "import", "api", "poll", "routing_form"]);
export const customFieldType = pgEnum("custom_field_type", [
  "text",
  "single_select",
  "number",
  "boolean",
  "currency",
  "date",
  "tags",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    primaryEmail: text("primary_email"), // denormalized from contact_emails
    phones: text("phones").array().notNull().default([]),
    timezone: text("timezone"),
    jobTitle: text("job_title"),
    company: text("company"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    linkedin: text("linkedin"),
    creationSource: contactSource("creation_source").notNull(),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    lastMeetingAt: ts("last_meeting_at"),
    nextMeetingAt: ts("next_meeting_at"),
    lastInteractionAt: ts("last_interaction_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("contacts_owner_name_idx").on(t.ownerUserId, t.name),
    index("contacts_owner_last_idx").on(t.ownerUserId, t.lastMeetingAt),
  ],
);

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: pk(),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull(), // denormalized
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    deletedAt: deletedAt(), // set together with contacts.deleted_at
  },
  (t) => [
    uniqueIndex("contact_emails_owner_uq").on(t.ownerUserId, t.emailNormalized).where(sql`deleted_at is null`),
    index("contact_emails_contact_idx").on(t.contactId),
  ],
);

export const contactNotes = pgTable(
  "contact_notes",
  {
    id: pk(),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    bodyHtml: text("body_html").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("contact_notes_contact_idx").on(t.contactId), index("contact_notes_author_idx").on(t.authorUserId)],
);

export const contactReminders = pgTable(
  "contact_reminders",
  {
    id: pk(),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull(),
    dueAt: ts("due_at").notNull(),
    text: text("text").notNull(),
    doneAt: ts("done_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contact_reminders_due_idx").on(t.dueAt).where(sql`done_at is null`),
    index("contact_reminders_contact_idx").on(t.contactId),
  ],
);

export const contactCustomFieldDefinitions = pgTable(
  "contact_custom_field_definitions",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fieldType: customFieldType("field_type").notNull(),
    options: jsonb("options").$type<{ id: string; label: string }[]>().notNull().default([]),
    currency: text("currency"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("contact_field_defs_owner_idx").on(t.ownerUserId)],
);

export const contactCustomFieldValues = pgTable(
  "contact_custom_field_values",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references((): AnyPgColumn => contactCustomFieldDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.definitionId] }),
    index("contact_field_values_definition_idx").on(t.definitionId),
  ],
);

export const contactLists = pgTable(
  "contact_lists",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contact_lists_owner_idx").on(t.ownerUserId)],
);

export const contactListMembers = pgTable(
  "contact_list_members",
  {
    listId: uuid("list_id")
      .notNull()
      .references((): AnyPgColumn => contactLists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.contactId] }), index("contact_list_members_contact_idx").on(t.contactId)],
);

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  owner: one(users, { fields: [contacts.ownerUserId], references: [users.id], relationName: "contacts.owner_user_id" }),
  emails: many(contactEmails, { relationName: "contact_emails.contact_id" }),
  notes: many(contactNotes, { relationName: "contact_notes.contact_id" }),
  reminders: many(contactReminders, { relationName: "contact_reminders.contact_id" }),
  customFieldValues: many(contactCustomFieldValues, { relationName: "contact_custom_field_values.contact_id" }),
  listMemberships: many(contactListMembers, { relationName: "contact_list_members.contact_id" }),
  invitees: many(invitees, { relationName: "invitees.contact_id" }),
  singleUseLinks: many(singleUseLinks, { relationName: "single_use_links.contact_id" }),
}));

export const contactEmailsRelations = relations(contactEmails, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactEmails.contactId],
    references: [contacts.id],
    relationName: "contact_emails.contact_id",
  }),
}));

export const contactNotesRelations = relations(contactNotes, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactNotes.contactId],
    references: [contacts.id],
    relationName: "contact_notes.contact_id",
  }),
  author: one(users, {
    fields: [contactNotes.authorUserId],
    references: [users.id],
    relationName: "contact_notes.author_user_id",
  }),
}));

export const contactRemindersRelations = relations(contactReminders, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactReminders.contactId],
    references: [contacts.id],
    relationName: "contact_reminders.contact_id",
  }),
}));

export const contactCustomFieldDefinitionsRelations = relations(contactCustomFieldDefinitions, ({ one, many }) => ({
  owner: one(users, {
    fields: [contactCustomFieldDefinitions.ownerUserId],
    references: [users.id],
    relationName: "contact_custom_field_definitions.owner_user_id",
  }),
  values: many(contactCustomFieldValues, { relationName: "contact_custom_field_values.definition_id" }),
}));

export const contactCustomFieldValuesRelations = relations(contactCustomFieldValues, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactCustomFieldValues.contactId],
    references: [contacts.id],
    relationName: "contact_custom_field_values.contact_id",
  }),
  definition: one(contactCustomFieldDefinitions, {
    fields: [contactCustomFieldValues.definitionId],
    references: [contactCustomFieldDefinitions.id],
    relationName: "contact_custom_field_values.definition_id",
  }),
}));

export const contactListsRelations = relations(contactLists, ({ one, many }) => ({
  owner: one(users, {
    fields: [contactLists.ownerUserId],
    references: [users.id],
    relationName: "contact_lists.owner_user_id",
  }),
  members: many(contactListMembers, { relationName: "contact_list_members.list_id" }),
}));

export const contactListMembersRelations = relations(contactListMembers, ({ one }) => ({
  list: one(contactLists, {
    fields: [contactListMembers.listId],
    references: [contactLists.id],
    relationName: "contact_list_members.list_id",
  }),
  contact: one(contacts, {
    fields: [contactListMembers.contactId],
    references: [contacts.id],
    relationName: "contact_list_members.contact_id",
  }),
}));
