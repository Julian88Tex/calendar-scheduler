// OWNER: foundation-ui.
//
// Client side of the integrations hub (SPEC CAL-21, walkthrough 17): search "Find integrations, apps, and more",
// category chips and the tile grid (logo, name, one-line description, "Connected" or "Not configured on this server"
// badges). The query and category are mirrored in the URL (?q=&category=) without a navigation. The page passes only
// the tiles and categories docs/SCOPE.md keeps.
"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { SearchInput } from "@/components/ui/search-input";
import { filterIntegrations, INTEGRATION_CATEGORIES, INTEGRATION_STATUS_LABELS, type IntegrationCategory, type IntegrationStatus } from "@/lib/integrations/catalog";

export type HubTile = {
  id: string;
  name: string;
  description: string;
  href: string | null;
  status: IntegrationStatus;
  logo: Parameters<typeof ProviderLogo>[0]["provider"];
  /** Extra line (Email delivery transport). */
  note?: string | null;
};

type Category = IntegrationCategory | "all";

function syncUrl(q: string, category: Category) {
  try {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (category !== "all") url.searchParams.set("category", category);
    else url.searchParams.delete("category");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // URL sync is a convenience only
  }
}

export type IntegrationsHubProps = {
  tiles: HubTile[];
  initialQuery: string;
  initialCategory: Category;
  /** Category chips to show (ids from INTEGRATION_CATEGORIES, "all" first); default every category. */
  categories?: readonly Category[];
};

export function IntegrationsHub({ tiles, initialQuery, initialCategory, categories }: IntegrationsHubProps) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<Category>(initialCategory);
  const byId = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const visible = filterIntegrations(query, category)
    .map((t) => byId.get(t.id))
    .filter((t): t is HubTile => Boolean(t));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <SearchInput
          className="max-w-xl"
          value={query}
          placeholder="Find integrations, apps, and more"
          aria-label="Find integrations, apps, and more"
          debounceMs={150}
          onValueChange={(v) => setQuery(v)}
          onSearch={(v) => syncUrl(v, category)}
        />
        <div role="group" aria-label="Categories" className="flex flex-wrap gap-2">
          {INTEGRATION_CATEGORIES.filter((c) => !categories || categories.includes(c.id)).map((c) => {
            const active = c.id === category;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(c.id);
                  syncUrl(query, c.id);
                }}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-[14px] font-semibold transition-colors",
                  active ? "border-primary bg-primary text-white" : "border-line-medium bg-white text-ink hover:border-ink-2 hover:bg-primary-soft",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {`${visible.length} ${visible.length === 1 ? "integration" : "integrations"}`}
      </p>
      {visible.length === 0 ? (
        <EmptyState
          illustration={<Illustration name="search" />}
          heading="No integrations match your search."
          body="Try another name or category."
          size="sm"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex size-12 items-center justify-center rounded-[10px] border border-line bg-white">
                    <ProviderLogo provider={t.logo} size={30} />
                  </span>
                  {t.status !== "available" && (
                    <Badge variant={t.status === "connected" ? "success" : "neutral"}>{INTEGRATION_STATUS_LABELS[t.status]}</Badge>
                  )}
                </div>
                <div className="mt-4 flex min-w-0 flex-col gap-1">
                  <span className="text-title-sm text-ink">{t.name}</span>
                  <span className="line-clamp-3 text-body-md text-ink-2">{t.description}</span>
                  {t.note && <span className="mt-1 text-body-sm font-semibold text-ink">{t.note}</span>}
                </div>
              </>
            );
            const cls = "flex h-full min-h-[172px] flex-col rounded-[var(--radius-card)] border border-line bg-white p-5 transition-[border-color,box-shadow] duration-100";
            return (
              <li key={t.id} className="min-w-0">
                {t.href ? (
                  <Link href={t.href as Route} className={cn(cls, "hover:border-line-medium hover:shadow-[var(--shadow-next)]")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
