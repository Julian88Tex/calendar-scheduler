// ARCHITECTURE section 5.4.14: routing forms, questions, routes, submissions and permissions.
import { relations } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { RoutingConditions, RoutingDestination, Tracking } from "../types.ts";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { permissionLevel } from "./_enums.ts";
import { users } from "./auth.ts";
import { organizations } from "./organizations.ts";
import { invitees } from "./bookings.ts";

export const routingFormStatus = pgEnum("routing_form_status", ["draft", "published"]);
export const routingQuestionType = pgEnum("routing_question_type", [
  "name",
  "email",
  "phone",
  "text",
  "textarea",
  "select",
  "radios",
  "checkboxes",
  "number",
]);

export type RoutingAnswer = { questionId: string; question: string; answer: string | string[] | null };

export const routingForms = pgTable(
  "routing_forms",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: routingFormStatus("status").notNull().default("draft"),
    headline: text("headline"),
    descriptionHtml: text("description_html"),
    submitLabel: text("submit_label").notNull().default("Submit"),
    locale: text("locale").notNull().default("en"),
    fallback: jsonb("fallback").$type<RoutingDestination>().notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("routing_forms_slug_uq").on(t.slug),
    index("routing_forms_org_idx").on(t.organizationId),
    index("routing_forms_owner_idx").on(t.ownerUserId),
  ],
);

export const routingFormQuestions = pgTable(
  "routing_form_questions",
  {
    id: pk(),
    formId: uuid("form_id")
      .notNull()
      .references((): AnyPgColumn => routingForms.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: routingQuestionType("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(false),
    choices: text("choices").array().notNull().default([]),
    placeholder: text("placeholder"),
    hidden: boolean("hidden").notNull().default(false),
    mapTo: text("map_to"), // 'invitee_name' | 'invitee_email' | 'sms_phone' | 'question:{label}'
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("routing_questions_idx").on(t.formId, t.position)],
);

export const routingFormRoutes = pgTable(
  "routing_form_routes",
  {
    id: pk(),
    formId: uuid("form_id")
      .notNull()
      .references((): AnyPgColumn => routingForms.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name"),
    conditions: jsonb("conditions").$type<RoutingConditions>().notNull(),
    destination: jsonb("destination").$type<RoutingDestination>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("routing_routes_idx").on(t.formId, t.position)],
);

export const routingFormSubmissions = pgTable(
  "routing_form_submissions",
  {
    id: pk(),
    formId: uuid("form_id")
      .notNull()
      .references((): AnyPgColumn => routingForms.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<RoutingAnswer[]>().notNull(),
    tracking: jsonb("tracking").$type<Tracking>().notNull().default({}),
    result: jsonb("result").$type<RoutingDestination & { routeId: string | null }>().notNull(),
    matchedRouteId: uuid("matched_route_id"),
    inviteeId: uuid("invitee_id"), // set when booked
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("routing_submissions_idx").on(t.formId, t.createdAt)],
);

export const routingFormPermissions = pgTable(
  "routing_form_permissions",
  {
    formId: uuid("form_id")
      .notNull()
      .references((): AnyPgColumn => routingForms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    level: permissionLevel("level").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.userId] }), index("routing_form_permissions_user_idx").on(t.userId)],
);

export const routingFormsRelations = relations(routingForms, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [routingForms.organizationId],
    references: [organizations.id],
    relationName: "routing_forms.organization_id",
  }),
  owner: one(users, {
    fields: [routingForms.ownerUserId],
    references: [users.id],
    relationName: "routing_forms.owner_user_id",
  }),
  questions: many(routingFormQuestions, { relationName: "routing_form_questions.form_id" }),
  routes: many(routingFormRoutes, { relationName: "routing_form_routes.form_id" }),
  submissions: many(routingFormSubmissions, { relationName: "routing_form_submissions.form_id" }),
  permissions: many(routingFormPermissions, { relationName: "routing_form_permissions.form_id" }),
}));

export const routingFormQuestionsRelations = relations(routingFormQuestions, ({ one }) => ({
  form: one(routingForms, {
    fields: [routingFormQuestions.formId],
    references: [routingForms.id],
    relationName: "routing_form_questions.form_id",
  }),
}));

export const routingFormRoutesRelations = relations(routingFormRoutes, ({ one }) => ({
  form: one(routingForms, {
    fields: [routingFormRoutes.formId],
    references: [routingForms.id],
    relationName: "routing_form_routes.form_id",
  }),
}));

export const routingFormSubmissionsRelations = relations(routingFormSubmissions, ({ one, many }) => ({
  form: one(routingForms, {
    fields: [routingFormSubmissions.formId],
    references: [routingForms.id],
    relationName: "routing_form_submissions.form_id",
  }),
  invitees: many(invitees, { relationName: "invitees.routing_form_submission_id" }),
}));

export const routingFormPermissionsRelations = relations(routingFormPermissions, ({ one }) => ({
  form: one(routingForms, {
    fields: [routingFormPermissions.formId],
    references: [routingForms.id],
    relationName: "routing_form_permissions.form_id",
  }),
  user: one(users, {
    fields: [routingFormPermissions.userId],
    references: [users.id],
    relationName: "routing_form_permissions.user_id",
  }),
}));
