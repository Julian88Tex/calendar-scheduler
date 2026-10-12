// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Integrations hub (SPEC CAL-21): tiles from src/lib/integrations/catalog.ts with env-based "Not configured on this
// server" badges. Foundation stub: a plain list.
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getFeatures } from "@/lib/env";
import { INTEGRATIONS, isIntegrationConfigured } from "@/lib/integrations/catalog";

export const metadata: Metadata = { title: "Integrations & apps" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IntegrationsPage({ searchParams }: Props) {
  await searchParams;
  const f = getFeatures();
  const flags = { googleOAuth: f.googleOAuth, microsoftOAuth: f.microsoftOAuth, zoom: f.zoom, stripe: f.stripe, sms: f.sms, email: f.email };
  return (
    <>
      <PageHeader title="Integrations & apps" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((tile) => (
          <li key={tile.id} className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            {tile.href ? (
              <Link href={tile.href as Route} className="text-title-sm">
                {tile.name}
              </Link>
            ) : (
              <span className="text-title-sm">{tile.name}</span>
            )}
            <p className="text-body-md text-ink-2">{tile.description}</p>
            {!isIntegrationConfigured(tile, flags) && <Badge variant="outline">Not configured on this server</Badge>}
          </li>
        ))}
      </ul>
    </>
  );
}
