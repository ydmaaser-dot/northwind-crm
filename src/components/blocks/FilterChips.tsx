import { cn } from "@/lib/utils";
import { type Tone, tone as toneOf } from "./tone";

/**
 * Pick one view of a list by state, each option with its count: All 12,
 * Met 6, Gap 3. Buttons with aria-pressed, so keyboards and screen readers
 * work.
 * - variant chips: a wrapping row of pills (the default; light)
 * - variant tiles: a grid of cards with the count large (for a review
 *   screen where the counts are the point)
 * - density compact | comfortable
 * Each option: { value, label, count?, tone? }; the tone draws a dot.
 */
export type FilterOption<T extends string = string> = {
  value: T;
  label: string;
  count?: number | null;
  tone?: Tone;
};

export type FilterChipsProps<T extends string = string> = {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "chips" | "tiles";
  density?: "compact" | "comfortable";
  className?: string;
  "aria-label"?: string;
};

export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
  variant = "chips",
  density = "comfortable",
  className,
  "aria-label": ariaLabel = "Filter",
}: FilterChipsProps<T>) {
  const tiles = variant === "tiles";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        tiles
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          : "flex flex-wrap gap-2",
        className,
      )}
    >
      {(options ?? []).map((option) => {
        const active = option.value === value;
        const hasCount =
          option.count !== undefined &&
          option.count !== null &&
          Number.isFinite(Number(option.count));
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-2 border text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
              tiles
                ? cn(
                    "justify-between rounded-lg",
                    density === "compact"
                      ? "px-3 py-2 text-sm"
                      : "px-4 py-3 text-sm",
                  )
                : cn(
                    "rounded-[calc(var(--radius)*2)]",
                    density === "compact"
                      ? "px-3 py-1 text-xs"
                      : "px-3.5 py-1.5 text-sm",
                  ),
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.tone && (
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-[calc(var(--radius)*2)]",
                    toneOf(option.tone).dot,
                    active && "ring-2 ring-primary-foreground/70",
                  )}
                  aria-hidden
                />
              )}
              <span className="truncate">{option.label}</span>
            </span>
            {hasCount && (
              <span
                className={cn(
                  "tabular-nums",
                  tiles
                    ? "font-display text-xl font-semibold"
                    : cn(
                        "rounded-[calc(var(--radius)*2)] px-1.5 text-xs",
                        active
                          ? "bg-primary-foreground/20"
                          : "bg-muted text-muted-foreground",
                      ),
                )}
              >
                {Number(option.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
