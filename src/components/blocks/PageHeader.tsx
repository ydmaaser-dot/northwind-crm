import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The top of an app screen: its title in the display face, one line under
 * it, the screen's main action on the right, and room below for numbers or
 * meters (`children`). On a phone the action moves under the title.
 * - variant plain: on the page background (the default)
 * - variant card: inside a bordered card
 * `back` is an optional link above the title ("All reviews").
 */
export type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "plain" | "card";
  className?: string;
  children?: React.ReactNode;
};

export function PageHeader({
  title,
  description,
  back,
  badges,
  actions,
  variant = "plain",
  className,
  children,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        variant === "card" &&
          "rounded-lg border bg-card p-5 text-card-foreground md:p-7",
        className,
      )}
    >
      {back && <div className="mb-3 text-sm">{back}</div>}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {badges && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {badges}
            </div>
          )}
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}
