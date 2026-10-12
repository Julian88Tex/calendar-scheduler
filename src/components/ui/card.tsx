// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Card, CardHeader, CardFooter (ARCHITECTURE 20.2): white surface with the card border, radius and shadow.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type CardProps = React.ComponentProps<"div"> & {
  padding?: "none" | "sm" | "md" | "lg";
  /** Hover and focus styles for clickable cards. */
  interactive?: boolean;
};

const PAD = { none: "", sm: "p-3", md: "p-5", lg: "p-8" } as const;

export function Card({ padding = "md", interactive, className, ...rest }: CardProps) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]", PAD[padding], interactive && "hover:border-ink-3", className)}
      {...rest}
    />
  );
}

export type CardHeaderProps = { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; headingLevel?: 2 | 3 };

export function CardHeader({ title, description, actions, className, headingLevel = 2 }: CardHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div>
        <Heading className="text-title-sm">{title}</Heading>
        {description && <p className="mt-1 text-body-md text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function CardFooter({ className, ...rest }: React.ComponentProps<"div">) {
  return <div className={cn("mt-4 flex justify-end gap-2 border-t border-line pt-4", className)} {...rest} />;
}
