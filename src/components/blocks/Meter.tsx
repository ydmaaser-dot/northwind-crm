import type * as React from "react";
import { cn } from "@/lib/utils";
import { percent, type Tone, tone as toneOf } from "./tone";

/**
 * How far along or how full: review progress, budget used, capacity booked.
 * - size thin | regular | thick
 * - tone colours the fill (accent by default; warning or danger when a
 *   limit is near or passed)
 * `label` and `valueLabel` sit above the bar ("Your progress", "4 of 12").
 * Any value is safe: missing, NaN or over `max` draws as 0 or full.
 */
export type MeterProps = React.HTMLAttributes<HTMLDivElement> & {
  value: number | null | undefined;
  max?: number;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  tone?: Tone;
  size?: "thin" | "regular" | "thick";
};

export function Meter({
  value,
  max = 100,
  label,
  valueLabel,
  tone = "accent",
  size = "regular",
  className,
  ...props
}: MeterProps) {
  const share = percent(value, max);
  return (
    <div className={cn("w-full min-w-0", className)} {...props}>
      {(label || valueLabel) && (
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate font-medium">{label}</span>
          {valueLabel && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share)}
        aria-label={typeof label === "string" ? label : undefined}
        className={cn(
          "w-full overflow-hidden rounded-[calc(var(--radius)*2)] bg-muted",
          size === "thin" && "h-1.5",
          size === "regular" && "h-2.5",
          size === "thick" && "h-4",
        )}
      >
        <div
          className={cn(
            "h-full rounded-[calc(var(--radius)*2)] transition-all",
            toneOf(tone).dot,
          )}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}
