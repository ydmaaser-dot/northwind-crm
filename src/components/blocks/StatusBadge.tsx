import type * as React from "react";
import { cn } from "@/lib/utils";
import { type Tone, tone as toneOf } from "./tone";

/**
 * A short state label: "Met", "Overdue", "Paid", "Draft". The tone says what
 * it means; the variant says how loud it is.
 * - soft: tinted background (the default, for lists)
 * - outline: a ring and coloured text (quiet, for dense tables)
 * - solid: filled (loud, for one state that must stand out)
 * - dot: a coloured dot and plain text (quietest)
 */
export type StatusBadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  variant?: "soft" | "outline" | "solid" | "dot";
  size?: "sm" | "md";
  icon?: React.ReactNode;
};

export function StatusBadge({
  tone = "neutral",
  variant = "soft",
  size = "sm",
  icon,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  const t = toneOf(tone);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius)*2)] font-medium leading-none",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variant === "soft" && t.soft,
        variant === "solid" && t.solid,
        variant === "outline" && cn("border bg-transparent", t.outline),
        variant === "dot" && "px-0 text-foreground",
        className,
      )}
      {...props}
    >
      {variant === "dot" && (
        <span
          className={cn("h-2 w-2 rounded-[calc(var(--radius)*2)]", t.dot)}
          aria-hidden
        />
      )}
      {icon}
      {children}
    </span>
  );
}
