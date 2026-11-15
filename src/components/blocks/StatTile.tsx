import type * as React from "react";
import { cn } from "@/lib/utils";
import { type Tone, tone as toneOf } from "./tone";

/**
 * One number that matters, with its label: "12 open", "Rs 84k this month".
 * - variant plain: no box (a row of numbers in a header)
 * - variant outlined: a bordered card (the default)
 * - variant filled: a muted surface
 * - variant accent: the app's primary colour, for the one number that leads
 * - density compact | comfortable
 * `delta` is a short change ("+8% vs last week") coloured by `deltaTone`.
 */
export type StatTileProps = React.HTMLAttributes<HTMLDivElement> & {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: Tone;
  icon?: React.ReactNode;
  variant?: "plain" | "outlined" | "filled" | "accent";
  density?: "compact" | "comfortable";
};

export function StatTile({
  label,
  value,
  hint,
  delta,
  deltaTone = "neutral",
  icon,
  variant = "outlined",
  density = "comfortable",
  className,
  ...props
}: StatTileProps) {
  const accent = variant === "accent";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-lg",
        density === "compact" ? "gap-1 p-3" : "gap-2 p-5",
        variant === "plain" && "p-0",
        variant === "outlined" && "border bg-card text-card-foreground",
        variant === "filled" && "bg-muted text-foreground",
        accent && "bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 text-sm font-medium",
          accent
            ? "text-primary-foreground/80"
            : variant === "filled"
              ? "text-foreground/75"
              : "text-muted-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {icon && (
          <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        )}
      </div>
      <div
        className={cn(
          "font-display font-semibold tabular-nums leading-tight tracking-tight",
          density === "compact" ? "text-2xl" : "text-3xl",
        )}
      >
        {value ?? "—"}
      </div>
      {(delta || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {delta && (
            <span
              className={cn(
                "font-semibold",
                accent ? "text-primary-foreground" : toneOf(deltaTone).text,
              )}
            >
              {delta}
            </span>
          )}
          {hint && (
            <span
              className={
                accent
                  ? "text-primary-foreground/75"
                  : variant === "filled"
                    ? "text-foreground/75"
                    : "text-muted-foreground"
              }
            >
              {hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
