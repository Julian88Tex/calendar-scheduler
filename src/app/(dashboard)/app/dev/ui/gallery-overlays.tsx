// OWNER: foundation-ui.
//
// Gallery: dialogs, sheets, confirmations, popovers, menus, tooltips, hover cards and toasts.
"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, ConfirmDialog } from "@/components/ui/alert-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSwitchItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { HoverCard } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { Sheet } from "@/components/ui/sheet";
import { Toast, toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Demo, GallerySection } from "./section";

export function OverlaysSection() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<false | "right" | "bottom">(false);
  const [active, setActive] = useState(true);
  return (
    <GallerySection id="overlays" title="Overlays and feedback" description="Every overlay traps focus, closes on Escape and returns focus to its trigger.">
      <Demo label="Dialogs">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => setSheet("right")}>
          Open side sheet
        </Button>
        <Button variant="secondary" onClick={() => setSheet("bottom")}>
          Open bottom sheet
        </Button>
        <ConfirmDialog
          trigger={<Button variant="destructive">Delete event type</Button>}
          title="Delete event type?"
          description="Users will be unable to schedule further meetings with deleted event types. Meetings previously scheduled will not be affected."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={async () => {
            await new Promise((r) => setTimeout(r, 600));
            toast.success("Event type deleted");
          }}
        />
        <AlertDialog
          trigger={<Button variant="secondary">Unsaved changes</Button>}
          title="You have unsaved changes"
          description="Leave this page and discard them?"
          footer={
            <>
              <AlertDialogCancel asChild>
                <Button variant="secondary">Keep editing</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive">Discard changes</Button>
              </AlertDialogAction>
            </>
          }
        />
      </Demo>
      <Demo label="Popover, menu, tooltip, hover card">
        <Popover trigger={<Button variant="secondary">Popover</Button>} aria-label="Quick note" className="w-72">
          <FormField label="Internal note">{(control) => <Input {...control} placeholder="Only you can see this" />}</FormField>
          <div className="mt-3 flex justify-end">
            <PopoverClose asChild>
              <Button size="sm">Save</Button>
            </PopoverClose>
          </div>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Kebab menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Event type</DropdownMenuLabel>
            <DropdownMenuItem icon={<Pencil aria-hidden="true" />} onSelect={() => toast("Edit")}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy aria-hidden="true" />} onSelect={() => toast("Duplicated")}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Trash2 aria-hidden="true" />} destructive onSelect={() => toast.error("Deleted")}>
              Delete
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSwitchItem checked={active} onCheckedChange={setActive}>
              On/Off
            </DropdownMenuSwitchItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content="Copies the link to this event type">
          <Button variant="tertiary">Hover or focus me</Button>
        </Tooltip>
        <HoverCard
          content={
            <div className="flex items-center gap-3">
              <Avatar name="Ana Lopez" size="lg" alt="" />
              <div>
                <p className="text-title-sm">Ana Lopez</p>
                <p className="text-body-sm text-ink-2">ana@example.com</p>
              </div>
            </div>
          }
        >
          <a href="mailto:ana@example.com" className="text-[14px] font-semibold text-primary-text underline">
            ana@example.com
          </a>
        </HoverCard>
      </Demo>
      <Demo label="Toasts">
        <Button onClick={() => toast.success("Changes saved")}>Show toast</Button>
        <Button variant="secondary" onClick={() => toast.error("Couldn't save. Try again.")}>
          Error toast
        </Button>
        <Button variant="secondary" onClick={() => toast.info("Link copied", { action: { label: "Undo", onClick: () => toast("Undone") } })}>
          Toast with action
        </Button>
      </Demo>
      <Demo label="Toast (inline)">
        <Toast kind="success" message="Changes saved" />
        <Toast kind="error" message="Something went wrong" description="Try again in a moment." />
      </Demo>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Example dialog"
        description="Dialogs trap focus and close on Escape."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </>
        }
      >
        <FormField label="Dialog input">{(control) => <Input {...control} placeholder="Focus starts here" />}</FormField>
      </Dialog>
      <Sheet
        open={sheet !== false}
        onOpenChange={(v) => !v && setSheet(false)}
        side={sheet === "bottom" ? "bottom" : "right"}
        title={sheet === "bottom" ? "Bottom sheet" : "Side sheet"}
        description="Used for troubleshoot details and mobile drawers."
        footer={<Button onClick={() => setSheet(false)}>Close sheet</Button>}
      >
        <p className="text-body-md text-ink-2">Sheet content scrolls independently.</p>
      </Sheet>
    </GallerySection>
  );
}
