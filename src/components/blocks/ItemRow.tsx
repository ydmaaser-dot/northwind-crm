import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { type Tone, tone as toneOf } from "./tone";

/**
 * One item in a list a person works through: a finding, an order, a case.
 * A coloured edge on the left says its state at a glance; a chevron says it
 * opens. Give `to` (a route) or `onClick` to make it open something.
 * - variant card: its own bordered card (the default; put rows in a
 *   `space-y-3` list)
 * - variant flat: a plain row (put rows in a `divide-y` list inside a card)
 * - density compact | comfortable
 * - tone: the edge colour; leave it out for no edge
 * `badges` sit above the title (a StatusBadge, an id); `meta` under it;
 * `trailing` on the right (a Meter, an amount, a date).
 */
export type ItemRowProps = {
  title: React.ReactNode;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  tone?: Tone;
  variant?: "card" | "flat";
  density?: "compact" | "comfortable";
  to?: string;
  onClick?: () => void;
  className?: string;
};

export function ItemRow({
  title,
  meta,
  badges,
  leading,
  trailing,
  tone,
  variant = "card",
  density = "comfortable",
  to,
  onClick,
  className,
}: ItemRowProps) {
  const interactive = Boolean(to || onClick);
  const classes = cn(
    "group flex w-full items-center gap-3 text-left transition-colors",
    density === "compact" ? "px-3 py-2.5" : "px-4 py-4 md:px-5",
    variant === "card" && "rounded-lg border bg-card text-card-foreground",
    variant === "flat" && "bg-transparent",
    tone && cn("border-l-4", toneOf(tone).edge),
    interactive &&
      "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        {badges && (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {badges}
          </div>
        )}
        <div
          className={cn(
            "font-medium leading-snug",
            density === "compact" ? "text-sm" : "text-base",
          )}
        >
          {title}
        </div>
        {meta && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
      {interactive && (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      )}
    </>
  );
  if (to)
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  return <div className={classes}>{body}</div>;
}
