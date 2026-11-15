import type * as React from "react";
import { cn } from "@/lib/utils";
import { type Tone, tone as toneOf } from "./tone";

/**
 * How a whole splits by state: findings by status, orders by stage.
 * `segments` is a list of { label, value, tone }; segments with no value are
 * left out, and an all-zero list draws an empty track.
 * - size thin | regular | thick
 * - legend: a line of dots with counts under the bar
 */
export type StackedBarSegment = {
  label: string;
  value: number;
  tone?: Tone;
};

export type StackedBarProps = React.HTMLAttributes<HTMLDivElement> & {
  segments: StackedBarSegment[];
  size?: "thin" | "regular" | "thick";
  legend?: boolean;
};

export function StackedBar({
  segments,
  size = "regular",
  legend = false,
  className,
  ...props
}: StackedBarProps) {
  const parts = (segments ?? []).map((s) => ({
    ...s,
    value: Number.isFinite(Number(s.value)) ? Math.max(0, Number(s.value)) : 0,
  }));
  const total = parts.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className={cn("w-full min-w-0", className)} {...props}>
      <div
        role="img"
        aria-label={parts.map((s) => `${s.value} ${s.label}`).join(", ")}
        className={cn(
          "flex w-full gap-0.5 overflow-hidden rounded-[calc(var(--radius)*2)] bg-muted",
          size === "thin" && "h-1.5",
          size === "regular" && "h-2.5",
          size === "thick" && "h-4",
        )}
      >
        {total > 0 &&
          parts
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.label}
                className={cn("h-full", toneOf(s.tone).dot)}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {parts.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-[calc(var(--radius)*2)]",
                  toneOf(s.tone).dot,
                )}
                aria-hidden
              />
              <span className="tabular-nums text-foreground">{s.value}</span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
