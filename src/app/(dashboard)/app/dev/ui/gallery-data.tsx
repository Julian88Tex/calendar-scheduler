// OWNER: foundation-ui.
//
// Gallery: avatars, badges, chips, cards, tables, empty states, banners, loading, logos and misc primitives.
"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DataTable, type DataTableSort } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Illustration, type IllustrationName } from "@/components/ui/illustration";
import { Kbd } from "@/components/ui/kbd";
import { Logo } from "@/components/ui/logo";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderLogo, type ProviderLogoName } from "@/components/ui/provider-logo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StickyFooterBar } from "@/components/ui/sticky-footer-bar";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { Demo, GallerySection } from "./section";

const PROVIDERS: ProviderLogoName[] = [
  "google", "microsoft", "outlook", "apple", "caldav", "ics", "zoom", "meet", "teams", "jitsi", "webex", "gotomeeting",
  "stripe", "paypal", "twilio", "webhook", "email", "api", "embed", "analytics", "meta",
];
const ILLUSTRATIONS: IllustrationName[] = ["calendar-plus", "calendar", "clock", "link", "users", "workflow", "routing", "chart", "search", "inbox", "poll", "integrations", "not-found", "error"];

type Row = { id: string; name: string; email: string; role: "Owner" | "Admin" | "User"; meetings: number };
const ROWS: Row[] = [
  { id: "1", name: "Julian Joseph", email: "julian@example.com", role: "Owner", meetings: 42 },
  { id: "2", name: "Ana Lopez", email: "ana@example.com", role: "Admin", meetings: 17 },
  { id: "3", name: "Ben Carter", email: "ben@example.com", role: "User", meetings: 8 },
];

export function DataSection() {
  const [sort, setSort] = useState<DataTableSort>({ columnId: "name", direction: "asc" });
  const [selected, setSelected] = useState<string[]>([]);
  const rows = useMemo(() => {
    const sorted = [...ROWS].sort((a, b) => {
      const key = (sort?.columnId ?? "name") as keyof Row;
      const av = a[key];
      const bv = b[key];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort?.direction === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [sort]);
  return (
    <GallerySection id="data" title="Data display" description="Avatars, badges, chips, cards, tables, empty states, banners and loading states.">
      <Demo label="Avatars">
        <Avatar name="Julian Joseph" size="xs" />
        <Avatar name="Julian Joseph" size="sm" />
        <Avatar name="Julian Joseph" size="md" />
        <Avatar name="Julian Joseph" size="lg" />
        <Avatar name="Julian Joseph" size="xl" />
        <Avatar name="Square Team" shape="square" size="lg" />
        <AvatarGroup users={[{ name: "Ana Lopez" }, { name: "Ben Carter" }, { name: "Cy Park" }, { name: "Dee Ray" }]} size="md" />
      </Demo>
      <Demo label="Badges and chips">
        <Badge>Neutral</Badge>
        <Badge variant="info">Secret</Badge>
        <Badge variant="success">Connected</Badge>
        <Badge variant="warning">Pending</Badge>
        <Badge variant="danger">Canceled</Badge>
        <Badge variant="outline">Not configured on this server</Badge>
        <Chip>Sales</Chip>
        <Chip variant="primary" onRemove={() => toast("Removed")} removeLabel="Remove ana@example.com">
          ana@example.com
        </Chip>
        <Chip variant="danger">Blocked</Chip>
      </Demo>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Card" description="White surface, hairline border, card shadow." actions={<Button size="sm" variant="secondary">Edit</Button>} />
          <p className="text-body-md text-ink">Cards hold settings groups and list rows.</p>
          <CardFooter>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
            <Button size="sm">Save changes</Button>
          </CardFooter>
        </Card>
        <Card interactive padding="md">
          <p className="text-title-sm">Interactive card</p>
          <p className="mt-1 text-body-md text-ink-2">Lifts its border on hover.</p>
        </Card>
      </div>
      <Demo label="Table" className="w-full">
        <Table>
          <TableCaption>Weekly hours</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Monday</TableCell>
              <TableCell>9:00am - 5:00pm</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Saturday</TableCell>
              <TableCell className="text-ink-2">Unavailable</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Demo>
      <Demo label="Data table (sortable, selectable)" className="w-full">
        <DataTable<Row>
          className="w-full"
          caption="People"
          rows={rows}
          getRowId={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          rowLabel={(r) => `Select ${r.name}`}
          columns={[
            { id: "name", header: "Name", sortable: true, cell: (r) => <span className="font-semibold">{r.name}</span> },
            { id: "email", header: "Email", cell: (r) => <span className="text-ink-2">{r.email}</span> },
            { id: "role", header: "Role", cell: (r) => <Badge variant={r.role === "Owner" ? "info" : "neutral"}>{r.role}</Badge> },
            { id: "meetings", header: "Meetings", sortable: true, align: "right", cell: (r) => r.meetings },
          ]}
        />
        <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
          <Button size="sm" variant="ghost" onClick={() => toast("Toggled")}>
            Toggle on/off
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.error("Deleted")}>
            Delete
          </Button>
        </BulkActionBar>
      </Demo>
      <div className="grid gap-4 lg:grid-cols-2">
        <DataTable<Row> caption="Empty table" rows={[]} getRowId={(r) => r.id} columns={[{ id: "name", header: "Name", cell: (r) => r.name }]} empty={<EmptyState size="sm" heading="No people yet" body="Invite your team to get started." />} />
        <DataTable<Row> caption="Loading table" rows={[]} loading getRowId={(r) => r.id} columns={[{ id: "name", header: "Name", cell: (r) => r.name }, { id: "email", header: "Email", cell: (r) => r.email }]} />
      </div>
      <Card padding="none">
        <EmptyState
          illustration={<Illustration name="calendar-plus" />}
          heading="Create scheduling links with event types"
          body="Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or office hours."
          action={<Button leftIcon={<Plus aria-hidden="true" />}>New event type</Button>}
        />
      </Card>
      <Demo label="Illustrations">
        {ILLUSTRATIONS.map((n) => (
          <span key={n} className="flex flex-col items-center gap-1 text-body-sm text-ink-2">
            <Illustration name={n} size={96} />
            {n}
          </span>
        ))}
      </Demo>
      <div className="flex flex-col gap-2">
        <Banner variant="info" title="Info">
          Your calendar is connected.
        </Banner>
        <Banner variant="success">Changes saved.</Banner>
        <Banner variant="warning" dismissible role="status">
          Reminders may be sent late.
        </Banner>
        <Banner variant="error" role="status" action={<Button size="sm" variant="secondary">Reconnect</Button>}>
          There is a problem with your calendar connection.
        </Banner>
      </div>
      <Demo label="Loading">
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
        <div className="w-64">
          <Skeleton lines={3} />
        </div>
        <Skeleton width={44} height={44} rounded="full" />
      </Demo>
      <Demo label="Provider logos">
        {PROVIDERS.map((p) => (
          <span key={p} className="flex w-16 flex-col items-center gap-1 text-[11px] text-ink-2">
            <ProviderLogo provider={p} size={32} title={p} />
            {p}
          </span>
        ))}
      </Demo>
      <Demo label="Logo, keys, separators, scroll area">
        <Logo />
        <Logo variant="mark" />
        <span className="text-body-md">
          Press <Kbd>Esc</Kbd> to close
        </span>
        <Separator orientation="vertical" className="h-8" />
        <Separator label="or" className="w-48" />
        <ScrollArea maxHeight={96} aria-label="Scrollable list" className="w-56 rounded-[var(--radius-input)] border border-line p-3">
          {Array.from({ length: 10 }, (_, i) => (
            <p key={i} className="text-body-md">
              Item {i + 1}
            </p>
          ))}
        </ScrollArea>
        <VisuallyHidden>Visually hidden text for screen readers</VisuallyHidden>
      </Demo>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
        <div className="p-5">
          <PageHeader title="Page header" description="Title, badge, help link and actions." badge={<Badge variant="info">Beta</Badge>} helpHref="/help" back={{ href: "/app/scheduling", label: "Back to Scheduling" }} actions={<Button size="sm">Action</Button>} className="mb-0" />
        </div>
        <StickyFooterBar start={<Button variant="tertiary" size="sm">More options</Button>}>
          <Button variant="secondary" size="sm">
            Cancel
          </Button>
          <Button size="sm">Save changes</Button>
        </StickyFooterBar>
      </div>
    </GallerySection>
  );
}
