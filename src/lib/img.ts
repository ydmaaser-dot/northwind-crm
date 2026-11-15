/**
 * Description-driven image resolution for generated apps.
 *
 * Blueprints never carry stock-photo URLs: the model writes a short visual
 * query (2-6 words) and this module resolves it to a real photograph whose
 * subject matches that query. Resolution is deterministic — the same query
 * always returns the same photo — and every lookup falls back to an inline SVG
 * gradient so a generated site can never show a broken image.
 *
 * Resolution order:
 * 1. Build-time API-resolved map (Unsplash/Pexels) — when API keys are set.
 * 2. Curated local catalog of Unsplash photos with keyword matching.
 * 3. Inline SVG gradient placeholder.
 *
 * Photos resolve to `images.unsplash.com`, which is one of only two image hosts
 * the published-site Content-Security-Policy allows. Resolving anywhere else
 * renders in preview and then silently fails once the site is published.
 */

import resolvedImages from "../content/resolved-images.json";
import { photoCatalog } from "./photo-catalog";

function hashQuery(query: string): number {
  let hash = 0;
  for (let index = 0; index < query.length; index += 1) {
    hash = (hash * 31 + query.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** The tile's colours when the site's theme gives none: a plain light grey. */
const PLAIN_TILE = "hsl(0, 0%, 90%)";

/** Reads one of the site's theme colours by its name in the stylesheet. */
type ThemeReader = (name: string) => string;

/**
 * A theme colour as an SVG can take it, or null when it is not one.
 *
 * The starter's theme writes a colour as three bare numbers ("24 10% 94%"),
 * which only mean a colour inside `hsl()`; a site may also write one out in
 * full. Anything else is refused, and only letters, digits and the few marks
 * a colour needs are let through, so no theme value can write markup into
 * the picture.
 */
function themeColor(raw: string): string | null {
  const value = raw.trim();
  const bare =
    /^(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%$/.exec(
      value,
    );
  if (bare) return `hsl(${bare[1]}, ${bare[2]}%, ${bare[3]}%)`;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^(?:hsla?|rgba?|oklch|oklab|lab|lch|hwb)\([\d\s.,%/+-]+\)$/i.test(value))
    return value;
  return null;
}

/**
 * The two colours of the tile, from the site's theme: its quiet surface and
 * its accent. One missing is filled with the other; both missing is grey.
 */
export function placeholderColors(read: ThemeReader): [string, string] {
  const muted = themeColor(read("--muted"));
  const accent = themeColor(read("--accent"));
  return [muted ?? accent ?? PLAIN_TILE, accent ?? muted ?? PLAIN_TILE];
}

/** The page's theme, where there is a page to read it from. */
function pageTheme(): ThemeReader {
  if (typeof document === "undefined") return () => "";
  const style = getComputedStyle(document.documentElement);
  return (name) => style.getPropertyValue(name);
}

/**
 * Inline SVG data URL shown where no photograph was found.
 *
 * Drawn in the site's own colours, read from its theme each time so a
 * change of theme (dark mode) is followed. It used to be one of eight fixed
 * colours picked by the subject's letters, and a coffee brand's warm page
 * got a blue square. The subject still decides which way the tile shades,
 * so two tiles side by side are not identical.
 */
export function imgPlaceholder(
  query: string,
  read: ThemeReader = pageTheme(),
): string {
  const [from, to] = placeholderColors(read);
  const [x2, y2] = (
    [
      [1, 1],
      [1, 0],
      [0, 1],
      [1, 0.5],
    ] as const
  )[hashQuery(query) % 4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="16" height="9" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Words that carry no subject meaning. Dropping them stops a query like "a
 * photo of the interior" from matching on "photo" alone, which would make every
 * such query resolve to the same catalog entry.
 */
const IGNORED_WORDS = new Set([
  "and",
  "background",
  "closeup",
  "for",
  "from",
  "image",
  "into",
  "its",
  "photo",
  "photograph",
  "picture",
  "shot",
  "the",
  "their",
  "this",
  "view",
  "with",
]);

function keywords(text: string): string[] {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((word) => word.length > 2 && !IGNORED_WORDS.has(word));
}

/**
 * Catalog keywords are split once at module load rather than per lookup: a
 * twelve page site resolves dozens of images and the catalog is constant.
 */
const indexedCatalog = photoCatalog.map(([id, tags]) => ({
  id,
  tags: new Set(tags.split(" ")),
}));

/**
 * How much a keyword is worth, by how rare it is across the catalog.
 *
 * Without this, a common adjective decides the match: "fresh coffee beans"
 * scores on "fresh" and lands on whatever unrelated photo happens to be
 * described as fresh. Rare words like "watchmaker" identify a subject, common
 * ones like "modern" do not, so weight is inversely proportional to how many
 * entries carry the word.
 */
const keywordWeight = new Map<string, number>();
for (const entry of indexedCatalog) {
  for (const tag of entry.tags) {
    keywordWeight.set(tag, (keywordWeight.get(tag) ?? 0) + 1);
  }
}
function weightOf(word: string): number {
  const frequency = keywordWeight.get(word) ?? 1;
  return indexedCatalog.length / (indexedCatalog.length + frequency * 4);
}

/**
 * Score one catalog entry against the query's keywords.
 *
 * Matching is exact. Prefix matching was tried and removed: it resolved
 * "butcher at work" to a workstation, "flower shop" to a flow, and "fresh
 * bread" to fresh olive oil. A photograph that is confidently wrong is worse
 * than an honest gradient, because it looks deliberate.
 *
 * A plural is the one exception worth handling, since the model writes "chairs"
 * where the catalog says "chair" and that is the same subject.
 *
 * Returns the weighted score, which ranks entries against each other, alongside
 * how many distinct query words were matched, which decides whether the entry is
 * eligible at all.
 */
function scoreEntry(
  entryTags: ReadonlySet<string>,
  words: string[],
): { score: number; matched: number } {
  let score = 0;
  let matched = 0;
  for (const word of words) {
    if (entryTags.has(word)) {
      score += 2 * weightOf(word);
      matched += 1;
      continue;
    }
    const singular = word.endsWith("s") ? word.slice(0, -1) : `${word}s`;
    if (singular.length > 2 && entryTags.has(singular)) {
      score += 2 * weightOf(singular);
      matched += 1;
    }
  }
  return { score, matched };
}

/**
 * Resolve a visual query to the catalog photo that best matches it.
 *
 * Ties are broken by the query hash offset with `sig`, so a grid of items
 * sharing one query still shows different photographs, and any given
 * (query, sig) pair always resolves to the same photo across renders and across
 * preview and published builds.
 *
 * Returns null when nothing matches, which the caller renders as a gradient
 * rather than as an unrelated photograph.
 */
export function resolvePhoto(query: string, sig = 0): string | null {
  const words = keywords(query);
  if (words.length === 0) return null;

  // A photo is eligible only when it explains the query rather than brushing
  // against it. One shared word out of several is how "bakery fresh bread"
  // became a bottle of olive oil: "fresh" matched and nothing else did. So an
  // entry has to match either two distinct words or half of what was asked for,
  // which still lets a one-word query through and still lets a rare subject word
  // like "watchmaker" carry a short query on its own.
  const scored: Array<{ id: string; score: number }> = [];
  const required = Math.max(1, Math.ceil(words.length / 2));
  for (const entry of indexedCatalog) {
    const { score, matched } = scoreEntry(entry.tags, words);
    if (matched >= 2 || matched >= required)
      scored.push({ id: entry.id, score });
  }
  if (scored.length === 0) return null;

  // Grids reuse one query across many items, so resolving only the best entry
  // would repeat the same photograph down the page. A caller that asks for a
  // variant selects from a shortlist of the closest matches, which keeps every
  // image on subject while still varying them. Everything else — heroes and
  // single images, which is most of a site — always gets the best match.
  scored.sort((left, right) => right.score - left.score);
  const variant = Math.abs(Math.trunc(sig));
  if (variant === 0) return scored[0].id;
  const shortlist = scored.slice(0, 6);
  return shortlist[(hashQuery(query) + variant) % shortlist.length].id;
}

/**
 * Picks within a query's resolved shortlist.
 *
 * The resolver already ordered the shortlist deterministically per query, so
 * sig 0 is the provider's best match for it and each later item in a grid
 * steps one along. Wrapping means a grid longer than the shortlist repeats
 * rather than falling back to one photograph for everything.
 */
export function pickResolved(
  candidates: readonly string[],
  sig: number,
): string | null {
  if (candidates.length === 0) return null;
  return candidates[Math.abs(Math.trunc(sig)) % candidates.length];
}

/**
 * Resolve a visual query to a photograph URL.
 *
 * @param query 2-6 word visual description, e.g. "cozy coffee shop interior".
 * @param width requested pixel width (clamped 40-2400).
 * @param height requested pixel height.
 * @param sig distinct values return distinct photos for the same query —
 *            pass the item index when rendering grids or lists.
 */
/**
 * Rewrites a Pexels URL to the size actually being rendered.
 *
 * The API hands back one fixed rendition — around 940x650 at roughly 300KB —
 * and a page places twenty of them, so honouring it everywhere would cost
 * several megabytes to display thumbnails. Pexels sizes on its own CDN, so the
 * existing dimensions are replaced rather than appended; `dpr` is dropped
 * because it multiplies whatever width is asked for.
 */
export function sizePexels(url: string, width: number, height: number): string {
  try {
    const sized = new URL(url);
    sized.searchParams.delete("dpr");
    sized.searchParams.set("auto", "compress");
    sized.searchParams.set("cs", "tinysrgb");
    sized.searchParams.set("fit", "crop");
    sized.searchParams.set("w", String(width));
    sized.searchParams.set("h", String(height));
    return sized.toString();
  } catch {
    return url;
  }
}

export function img(
  query: string,
  width = 1200,
  height = 800,
  sig = 0,
): string {
  const w = Math.min(2400, Math.max(40, Math.round(width)));
  const h = Math.min(2400, Math.max(40, Math.round(height)));

  // A row people add keeps its photo description empty, and the app is
  // compiled without strict null checks, so a null can arrive here. Nothing
  // to look up is a plain tile, never a page taken to the crash screen.
  if (typeof query !== "string" || query.trim() === "")
    return imgPlaceholder("");

  // 1. Build-time API-resolved map (Unsplash/Pexels).
  //
  // The map holds a shortlist per query and `sig` picks within it, exactly as
  // the local catalogue does. It used to hold one URL and ignore `sig`
  // entirely, so on a site whose images resolved through the API — which is
  // every site with the keys set — a grid showed one photograph repeated for
  // every item, however carefully the page passed its index.
  const entry = (resolvedImages as Record<string, string | string[]>)[
    query.trim().toLowerCase()
  ];
  const candidates = typeof entry === "string" ? [entry] : (entry ?? []);
  if (candidates.length > 0) {
    const resolved = pickResolved(candidates, sig) as string;
    if (resolved.includes("images.unsplash.com")) {
      const separator = resolved.includes("?") ? "&" : "?";
      return `${resolved}${separator}w=${w}&h=${h}&fit=crop`;
    }
    if (resolved.includes("images.pexels.com")) {
      return sizePexels(resolved, w, h);
    }
    return resolved;
  }

  // 2. Curated local catalog with keyword matching.
  const photo = resolvePhoto(query, sig);
  if (photo) {
    return `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&q=80&w=${w}&h=${h}`;
  }

  // 3. Gradient placeholder — never a broken image.
  return imgPlaceholder(query);
}

/** Backwards-compatible lookup for legacy blueprints that carry asset ids. */
export function imgFromLegacyId(id: string): string {
  const query = id.replace(/^[a-z]+-/, "").replace(/-/g, " ");
  return img(query);
}
