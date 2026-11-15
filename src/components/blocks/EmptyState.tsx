import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * What a list or a page shows when there is nothing in it yet, or nothing
 * matches: a title in plain words, one line on why, and the next step as an
 * action ("Add your first order", "Clear the filters").
 * - variant plain: centred text only (inside a card that already has a frame)
 * - variant dashed: a dashed outline where the items would be (the default)
 * - variant card: a filled muted panel
 * - size compact | comfortable
 */
export type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  variant?: "plain" | "dashed" | "card";
  size?: "compact" | "comfortable";
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = "dashed",
  size = "comfortable",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        size === "compact" ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        variant === "dashed" && "rounded-lg border border-dashed",
        variant === "card" && "rounded-lg bg-muted",
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[calc(var(--radius)*2)] text-muted-foreground [&_svg]:h-5 [&_svg]:w-5",
            variant === "card" ? "bg-background" : "bg-muted",
          )}
        >
          {icon}
        </div>
      )}
      <p
        className={cn(
          "font-display font-semibold",
          size === "compact" ? "text-base" : "text-lg",
        )}
      >
        {title}
      </p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
