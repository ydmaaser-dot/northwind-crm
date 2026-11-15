import "./tokens.css";

/**
 * What a state means, said once for every block: the colour of a dot, a bar,
 * a soft or solid badge and a row's edge. Every colour is a theme token
 * (--primary, --muted, --foreground, and --success, --warning, --info and
 * --danger from tokens.css), so a state follows the app's palette and its dark mode.
 */
export type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export const toneClasses: Record<
  Tone,
  {
    dot: string;
    soft: string;
    solid: string;
    outline: string;
    edge: string;
    text: string;
  }
> = {
  neutral: {
    dot: "bg-muted-foreground",
    soft: "bg-muted text-foreground",
    solid: "bg-foreground text-background",
    outline: "border-muted-foreground text-foreground",
    edge: "border-l-muted-foreground",
    text: "text-foreground/75",
  },
  info: {
    dot: "bg-[hsl(var(--info))]",
    soft: "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
    solid: "bg-[hsl(var(--info))] text-[hsl(var(--info-foreground))]",
    outline: "border-[hsl(var(--info))] text-[hsl(var(--info))]",
    edge: "border-l-[hsl(var(--info))]",
    text: "text-[hsl(var(--info))]",
  },
  success: {
    dot: "bg-[hsl(var(--success))]",
    soft: "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]",
    solid: "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]",
    outline: "border-[hsl(var(--success))] text-[hsl(var(--success))]",
    edge: "border-l-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
  },
  warning: {
    dot: "bg-[hsl(var(--warning))]",
    soft: "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]",
    solid: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
    outline: "border-[hsl(var(--warning))] text-[hsl(var(--warning))]",
    edge: "border-l-[hsl(var(--warning))]",
    text: "text-[hsl(var(--warning))]",
  },
  danger: {
    dot: "bg-[hsl(var(--danger))]",
    soft: "bg-[hsl(var(--danger)/0.12)] text-[hsl(var(--danger))]",
    solid: "bg-[hsl(var(--danger))] text-[hsl(var(--danger-foreground))]",
    outline: "border-[hsl(var(--danger))] text-[hsl(var(--danger))]",
    edge: "border-l-[hsl(var(--danger))]",
    text: "text-[hsl(var(--danger))]",
  },
  accent: {
    dot: "bg-primary",
    soft: "bg-primary/10 text-primary",
    solid: "bg-primary text-primary-foreground",
    outline: "border-primary text-primary",
    edge: "border-l-primary",
    text: "text-primary",
  },
};

/** A tone that is not one of the six reads as neutral, never as nothing. */
export function tone(value: Tone | undefined | null) {
  return toneClasses[value as Tone] ?? toneClasses.neutral;
}

/** A share in percent, 0 to 100, for any value a page may hand over. */
export function percent(value: unknown, max: unknown = 100) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.min(100, Math.max(0, (v / m) * 100));
}
