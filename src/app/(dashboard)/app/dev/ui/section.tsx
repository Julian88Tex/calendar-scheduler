// OWNER: foundation-ui.
//
// Gallery layout helpers: a titled section card and a labelled demo cell.
import type * as React from "react";
import { cn } from "@/lib/cn";

export function GallerySection({ id, title, description, children, className }: { id: string; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5 sm:p-6", className)}>
      <h2 id={`${id}-title`} className="text-title-lg text-ink">
        {title}
      </h2>
      {description && <p className="mt-1 text-body-md text-ink-2">{description}</p>}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function Demo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <h3 className="text-eyebrow text-ink-2">{label}</h3>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
