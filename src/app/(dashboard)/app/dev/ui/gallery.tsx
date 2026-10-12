// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Client side of the UI kit gallery.
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { toast } from "@/components/ui/toast";

export function DevGallery() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [color, setColor] = useState("#8247f5");
  const [zone, setZone] = useState("America/New_York");
  const [month, setMonth] = useState("2026-10");
  const [day, setDay] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="UI kit" description="Every component of the design system (ARCHITECTURE 20.2)." />
      <Card>
        <CardHeader title="Buttons" />
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Loading</Button>
          <Button onClick={() => toast.success("Changes saved")}>Show toast</Button>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open dialog
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Form controls" />
        <div className="flex max-w-md flex-col gap-4">
          <FormField label="Name" required hint="As shown to invitees">
            {(control) => <Input {...control} placeholder="Jane Doe" />}
          </FormField>
          <FormField label="Email" error="Enter a valid email address">
            {(control) => <Input {...control} type="email" />}
          </FormField>
          <Checkbox label="Allow invitees to add guests" checked={checked} onCheckedChange={setChecked} />
          <Switch aria-label="Active" checked={checked} onCheckedChange={setChecked} showStateLabel />
          <ColorPicker value={color} onChange={setColor} />
          <TimeZoneSelect value={zone} onChange={setZone} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Feedback" />
        <div className="flex flex-col gap-2">
          <Banner variant="info">An informational banner.</Banner>
          <Banner variant="warning" dismissible>
            A dismissible warning.
          </Banner>
          <div className="flex gap-2">
            <Badge>Neutral</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="danger">Danger</Badge>
          </div>
          <EmptyState heading="Nothing here yet" body="Empty states explain what to do next." size="sm" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Month calendar" />
        <MonthCalendar month={month} onMonthChange={setMonth} selected={day} onSelect={setDay} availableDates={[`${month}-14`, `${month}-15`, `${month}-16`]} />
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Example dialog" description="Dialogs trap focus and close on Escape." footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
        <p className="text-body-md">Dialog content.</p>
      </Dialog>
    </div>
  );
}
