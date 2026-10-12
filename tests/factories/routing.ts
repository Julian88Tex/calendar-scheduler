// Routing forms with questions and routes.
import type { DbOrTx } from "@/db";
import { routingFormQuestions, routingFormRoutes, routingForms } from "@/db/schema";
import type { RoutingConditions, RoutingDestination } from "@/db/types";
import { one, uniq } from "./_util";
import type { TestUser } from "./users";

export type RoutingFormRow = typeof routingForms.$inferSelect;

export type CreateRoutingFormOptions = {
  owner: TestUser;
  name?: string;
  slug?: string;
  status?: "draft" | "published";
  questions?: {
    label: string;
    type?: (typeof routingFormQuestions.$inferInsert)["type"];
    required?: boolean;
    choices?: string[];
    mapTo?: string | null;
  }[];
  /** Routes in order; conditions reference routing_form_questions ids (insert questions first when needed). */
  routes?: { name?: string; conditions?: RoutingConditions; destination: RoutingDestination }[];
  fallback?: RoutingDestination;
};

export async function createRoutingForm(db: DbOrTx, opts: CreateRoutingFormOptions) {
  const slug = opts.slug ?? uniq("rf");
  const form = one(
    await db
      .insert(routingForms)
      .values({
        organizationId: opts.owner.organizationId,
        ownerUserId: opts.owner.id,
        name: opts.name ?? "Routing form",
        slug,
        status: opts.status ?? "published",
        publishedAt: (opts.status ?? "published") === "published" ? new Date() : null,
        fallback: opts.fallback ?? { type: "custom_message", headline: "Thanks", body: "We will be in touch." },
      })
      .returning(),
    "routing form",
  );
  const questionSpecs = opts.questions ?? [
    { label: "Name", type: "name" as const, required: true, mapTo: "invitee_name" },
    { label: "Email", type: "email" as const, required: true, mapTo: "invitee_email" },
  ];
  const questions = questionSpecs.length
    ? await db
        .insert(routingFormQuestions)
        .values(
          questionSpecs.map((q, i) => ({
            formId: form.id,
            position: i,
            label: q.label,
            type: q.type ?? "text",
            required: q.required ?? false,
            choices: q.choices ?? [],
            mapTo: q.mapTo ?? null,
          })),
        )
        .returning()
    : [];
  const routes = opts.routes?.length
    ? await db
        .insert(routingFormRoutes)
        .values(
          opts.routes.map((r, i) => ({
            formId: form.id,
            position: i,
            name: r.name ?? null,
            conditions: r.conditions ?? { logic: "all", conditions: [] },
            destination: r.destination,
          })),
        )
        .returning()
    : [];
  return { form, questions, routes };
}
