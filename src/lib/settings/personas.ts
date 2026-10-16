// Settings > Personas (lib/personas.ts in the booking components): the host's personas, each with its link id, look,
// default flag and the words of its landing page, booking form and confirmation, stored in users.preferences.personas.
// Saving also keeps every personal event type's persona list (event_types.metadata.personas) in step: a renamed link id
// moves with its wording, a removed persona is dropped, and a new one starts enabled on every event type under the
// real names. Server only.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { eventTypes, users } from "@/db/schema";
import { PERSONA_ID_RE, PERSONA_LIMITS, eventPersonasOf, personasOf, type EventPersonas, type Persona } from "@/components/booking/lib/personas";
import { AppError } from "@/lib/errors";
import { now } from "@/lib/time/now";

const short = z.string().trim().max(PERSONA_LIMITS.short);
const medium = z.string().trim().max(PERSONA_LIMITS.medium);

const PersonaInput = z.object({
  /** The id the persona had when the form loaded (null for a new one), so a changed link id keeps its event wording. */
  originalId: z.string().max(PERSONA_LIMITS.id).nullable(),
  id: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Every persona needs a link name.")
    .max(PERSONA_LIMITS.id)
    .regex(PERSONA_ID_RE, "Link names use lowercase letters, numbers and dashes."),
  name: z.string().trim().min(1, "Every persona needs a name.").max(PERSONA_LIMITS.short),
  isDefault: z.boolean(),
  style: z.enum(["warm", "classic"]),
  greeting: short,
  note: z.string().trim().max(PERSONA_LIMITS.long),
  signOff: short,
  favoritesHeading: short,
  favorites: z.array(z.object({ emoji: z.string().trim().max(PERSONA_LIMITS.emoji), label: short })).max(PERSONA_LIMITS.favorites),
  chooseHeading: short,
  detailsIntro: medium,
  confirmationNote: medium,
});

export const PersonasSettingsInput = z
  .object({ personas: z.array(PersonaInput).min(1, "Keep at least one persona.").max(PERSONA_LIMITS.personas) })
  .superRefine((v, ctx) => {
    const ids = v.personas.map((p) => p.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) ctx.addIssue({ code: "custom", message: `Two personas use the link name "${dup}".`, path: ["personas"] });
    if (v.personas.filter((p) => p.isDefault).length !== 1) ctx.addIssue({ code: "custom", message: "Pick exactly one default persona.", path: ["personas"] });
  });
export type PersonasSettingsValues = z.infer<typeof PersonasSettingsInput>;
export type PersonaFormValue = PersonasSettingsValues["personas"][number];

/** An event type's persona list after a save: renamed ids moved, removed ones dropped, new ones added. */
export function remapEventPersonas(current: EventPersonas, personas: PersonaFormValue[]): EventPersonas {
  const out: EventPersonas = {};
  for (const p of personas) {
    if (p.originalId === null) out[p.id] = { name: "", description: "" };
    else if (current[p.originalId]) out[p.id] = current[p.originalId]!;
  }
  return out;
}

/** Saves the personas and returns them as pages will show them. */
export async function savePersonasSettings(db: DbOrTx, userId: string, input: PersonasSettingsValues): Promise<Persona[]> {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (!user) throw new AppError("not_found", "This account no longer exists.");
  const stored = input.personas.map(({ originalId: _o, ...p }) => ({ ...p, favorites: p.favorites.filter((f) => f.label) }));
  const types = await db
    .select({ id: eventTypes.id, slug: eventTypes.slug, metadata: eventTypes.metadata })
    .from(eventTypes)
    .where(and(eq(eventTypes.ownerUserId, userId), eq(eventTypes.scope, "personal"), isNull(eventTypes.teamId), isNull(eventTypes.deletedAt)));
  for (const t of types) {
    const personas = remapEventPersonas(eventPersonasOf(t.metadata, t.slug, user.preferences), input.personas);
    await db
      .update(eventTypes)
      .set({ metadata: { ...((t.metadata ?? {}) as Record<string, unknown>), personas } })
      .where(eq(eventTypes.id, t.id));
  }
  const [row] = await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ personas: stored })}::jsonb`, updatedAt: now() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({ preferences: users.preferences });
  if (!row) throw new AppError("not_found", "This account no longer exists.");
  return personasOf(row.preferences);
}
