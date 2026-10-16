// OWNER: contacts. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ContactPicker (ARCHITECTURE section 25): search the host's contacts or type a name and email (single-use links, book
// on behalf, share availability, polls). Foundation stub: plain name and email inputs.
"use client";

import { Input } from "../ui/input";

export type ContactPickerValue = { name: string; email: string; contactId?: string | null };

export type ContactPickerProps = {
  value: ContactPickerValue | null;
  onChange: (value: ContactPickerValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function ContactPicker({ value, onChange, placeholder, disabled }: ContactPickerProps) {
  const current = value ?? { name: "", email: "" };
  const emit = (next: ContactPickerValue) => onChange(next.name || next.email ? next : null);
  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="Name" placeholder={placeholder ?? "Name"} value={current.name} disabled={disabled} onChange={(e) => emit({ ...current, name: e.target.value, contactId: null })} />
      <Input aria-label="Email" type="email" placeholder="Email" value={current.email} disabled={disabled} onChange={(e) => emit({ ...current, email: e.target.value, contactId: null })} />
    </div>
  );
}
