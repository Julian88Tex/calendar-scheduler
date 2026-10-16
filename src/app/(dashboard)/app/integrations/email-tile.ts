// Where each tile of the integrations hub leads (page.tsx). The Email delivery tile opens the email outbox page
// (docs/QA_REPORT.md, "Found outside these paths" item 6), where the owner sees every email sent or waiting, for the
// people who may open it (instance admins and organization owners, ../settings/email-outbox/access.ts); for anyone else
// it stays a status only tile. Pure.

export const EMAIL_OUTBOX_HREF = "/app/settings/email-outbox";

/** The tile's link: the catalog's detail page, or the outbox for the Email delivery tile (null: no link). */
export function hubTileHref(tileId: string, catalogHref: string | null, canSeeOutbox: boolean): string | null {
  if (tileId === "email") return canSeeOutbox ? EMAIL_OUTBOX_HREF : null;
  return catalogHref;
}
