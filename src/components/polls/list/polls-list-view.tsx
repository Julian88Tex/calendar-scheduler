// The Meeting polls tab of Scheduling (SPEC MP-26; research B13): filter chips Open (default, closed unbooked included),
// Booked, Ended, All; search; "Hosted by" when the organization has other people; one card per poll with the purple
// left border, title and status, "{duration} · {n} times", the option date range, responses with a mini progress bar
// and the "New" dot, the deadline or "Booked for {time}" with "View meeting", the top time, "Copy link", "View results"
// and the kebab menu; "Load more" (25 per page); empty states. The URL holds the filters (?filter=&q=&hosted=). Client
// component.
"use client";

import { Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration } from "@/components/ui/illustration";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { listPollsAction } from "@/lib/polls/actions";
import type { PollListFilter, PollListItem } from "@/lib/polls/types";
import { failureMessage, unwrap } from "../lib/action";
import { pt } from "../lib/t";
import type { PollsListProps } from "../types";
import { PollCard } from "./poll-card";

const FILTERS: { value: PollListFilter; label: string }[] = [
  { value: "open", label: pt("list.filterOpen") },
  { value: "booked", label: pt("list.filterBooked") },
  { value: "ended", label: pt("list.filterEnded") },
  { value: "all", label: pt("list.filterAll") },
];

export function PollsListView(props: PollsListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [extra, setExtra] = useState<PollListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(props.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, startTransition] = useTransition();
  const items = [...props.items, ...extra.filter((e) => !props.items.some((i) => i.id === e.id))];

  const setQuery = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (k === "filter" && v === "open") || (k === "hosted" && v === "all")) q.delete(k);
      else q.set(k, v);
    }
    setExtra([]);
    startTransition(() => router.replace(`${pathname}${q.toString() ? `?${q}` : ""}` as Route, { scroll: false }));
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await unwrap(listPollsAction({ filter: props.filter, q: props.q || undefined, hostedBy: props.hostedBy, cursor }));
      setExtra((x) => [...x, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(failureMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = Boolean(props.q) || props.hostedBy !== "all";
  const empty = items.length === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="meeting-polls">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={pt("list.filtersLabel")}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={props.filter === f.value}
              onClick={() => setQuery({ filter: f.value })}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-4 text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-sm:h-10",
                props.filter === f.value ? "border-primary bg-primary-soft text-primary-text" : "border-line bg-white text-ink hover:border-line-medium",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            defaultValue={props.q}
            onSearch={(v) => setQuery({ q: v.trim() || null })}
            placeholder={pt("list.searchPlaceholder")}
            aria-label={pt("list.searchPlaceholder")}
            className="w-full sm:w-[240px]"
          />
          {props.showHostedBy && (
            <Select
              aria-label={pt("list.hostedBy")}
              value={props.hostedBy}
              onValueChange={(v) => setQuery({ hosted: v })}
              className="w-[190px]"
              options={[
                { value: "all", label: `${pt("list.hostedBy")}: ${pt("list.hostedByAll")}` },
                { value: "me", label: `${pt("list.hostedBy")}: ${pt("list.hostedByMe")}` },
                { value: "cohosted", label: pt("list.hostedByCohosted") },
              ]}
            />
          )}
          <Button asChild variant="secondary" leftIcon={<Plus aria-hidden="true" className="size-4" />}>
            <Link href="/app/polls/new">{pt("list.newPoll")}</Link>
          </Button>
        </div>
      </div>

      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {empty ? (
          <EmptyState
            illustration={<Illustration name="poll" />}
            heading={
              filtered
                ? pt("list.emptyFilteredHeading")
                : props.filter === "booked"
                  ? pt("list.emptyBookedHeading")
                  : props.filter === "ended"
                    ? pt("list.emptyEndedHeading")
                    : pt("list.emptyHeading")
            }
            body={
              filtered
                ? pt("list.emptyFilteredBody")
                : props.filter === "booked"
                  ? pt("list.emptyBookedBody")
                  : props.filter === "ended"
                    ? pt("list.emptyEndedBody")
                    : pt("list.emptyBody")
            }
            action={
              !filtered && (props.filter === "open" || props.filter === "all") ? (
                <Button asChild leftIcon={<Plus aria-hidden="true" className="size-4" />}>
                  <Link href="/app/polls/new">{pt("list.newPoll")}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label={pt("common.meetingPoll")}>
            {items.map((item) => (
              <PollCard key={item.id} item={item} viewer={props.viewer} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </div>

      {cursor && !empty && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
            {pt("list.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
