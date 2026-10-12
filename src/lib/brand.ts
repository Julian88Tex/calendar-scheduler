// Product identity (SPEC GEN-01): the name comes from NEXT_PUBLIC_APP_NAME (default "Kairos"). Client safe: Next
// inlines NEXT_PUBLIC_* variables into client bundles at build time.

export const DEFAULT_APP_NAME = "Kairos";

/** The product name, read now (tests and scripts may change the environment). */
export function appName(): string {
  return (process.env.NEXT_PUBLIC_APP_NAME || "").trim() || DEFAULT_APP_NAME;
}

/** The product name at module load ("{AppName}" in the spec). */
export const APP_NAME: string = appName();

/** URL-safe lowercase form of a product name ("Acme Scheduling" -> "acme-scheduling"), used in Jitsi rooms. */
export function toAppNameSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "kairos";
}

/** URL-safe form of APP_NAME. */
export const appNameSlug: string = toAppNameSlug(APP_NAME);
