// ARCHITECTURE section 5.4.3: uploaded files (bytes in `data`, or in Vercel Blob when BLOB_READ_WRITE_TOKEN is set).
// Served by GET /api/files/{id}: public for avatar, logo, team_avatar and org_logo (immutable cache, content-hash ETag);
// owner-only for import and export.
import { relations } from "drizzle-orm";
import { type AnyPgColumn, index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, pk, ts } from "./_columns.ts";
import { users } from "./auth.ts";
import { organizations, teams } from "./organizations.ts";

export { bytea };

export const filePurpose = pgEnum("file_purpose", [
  "avatar",
  "logo",
  "team_avatar",
  "org_logo",
  "import",
  "export",
  "attachment",
]);

export const files = pgTable(
  "files",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id"),
    purpose: filePurpose("purpose").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data"), // null when stored in Vercel Blob
    blobUrl: text("blob_url"),
    width: integer("width"),
    height: integer("height"),
    expiresAt: ts("expires_at"), // exports
    createdAt: createdAt(),
  },
  (t) => [index("files_owner_idx").on(t.ownerUserId)],
);

export const filesRelations = relations(files, ({ one, many }) => ({
  owner: one(users, { fields: [files.ownerUserId], references: [users.id], relationName: "files.owner_user_id" }),
  avatarForUsers: many(users, { relationName: "users.avatar_file_id" }),
  logoForUsers: many(users, { relationName: "users.logo_file_id" }),
  logoForOrganizations: many(organizations, { relationName: "organizations.logo_file_id" }),
  avatarForTeams: many(teams, { relationName: "teams.avatar_file_id" }),
}));
