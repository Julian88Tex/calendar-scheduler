// OWNER: foundation-ui.
//
// Card, CardHeader, CardFooter (ARCHITECTURE 20.2, walkthrough 1.4): white surface, 1px #D4E0ED border, 8px radius and
// the card shadow; interactive cards lift their border and shadow on hover and focus. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type CardProps = React.ComponentProps<"div"> & {
  padding?: "none" | "sm" | "md" | "lg";
  /** Hover and focus styles for clickable cards. */
  interactive?: boolean;
  /** Drop the shadow (flat cards inside other cards). */
  flat?: boolean;
};

const PAD = { none: "", sm: "p-3", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;

export function Card({ padding = "md", interactive, flat, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-card)] border border-line bg-white text-ink",
        !flat && "shadow-[var(--shadow-card)]",
        PAD[padding],
        interactive && "transition-[border-color,box-shadow] duration-100 hover:border-line-medium hover:shadow-[var(--shadow-next)] focus-within:border-line-medium",
        className,
      )}
      {...rest}
    />
  );
}

export type CardHeaderProps = { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; headingLevel?: 2 | 3 };

export function CardHeader({ title, description, actions, className, headingLevel = 2 }: CardHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1">
        <Heading className="text-title-md text-ink">{title}</Heading>
        {description && <p className="mt-1 text-body-md text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CardFooter({ className, ...rest }: React.ComponentProps<"div">) {
  return <div className={cn("mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4", className)} {...rest} />;
}
