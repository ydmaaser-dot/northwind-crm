import { Search, X } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A search box for a list: a magnifier, the text, and a clear button once
 * something is typed. Controlled: pass `value` and `onChange(text)`.
 * - shape theme: the theme's corner (the default)
 * - shape pill: three times the theme's corner (round in a soft app,
 *   square in a square-cornered one)
 * - size md | lg
 */
export type SearchInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "size"
> & {
  value: string;
  onChange: (value: string) => void;
  shape?: "theme" | "pill";
  size?: "md" | "lg";
};

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      shape = "theme",
      size = "md",
      placeholder = "Search",
      className,
      ...props
    },
    ref,
  ) => {
    const text = value ?? "";
    return (
      <div className={cn("relative w-full", className)}>
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={ref}
          type="search"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={props["aria-label"] ?? placeholder}
          className={cn(
            "bg-card pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden",
            size === "lg" ? "h-12 text-base" : "h-10",
            shape === "pill" ? "rounded-[calc(var(--radius)*3)]" : "rounded-lg",
          )}
          {...props}
        />
        {text && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[calc(var(--radius)*2)] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
