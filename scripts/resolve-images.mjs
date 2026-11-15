/**
 * Build-time image resolution: reads blueprint.json, resolves every image
 * query through Pexels (preferred) or Unsplash (fallback), and writes a
 * deterministic resolved-images.json that the runtime img() function reads.
 *
 * Env vars consumed:
 *   PEXELS_API_KEY      — Pexels API key (preferred provider)
 *   UNSPLASH_ACCESS_KEY — Unsplash API access key (fallback provider)
 *
 * Output: src/content/resolved-images.json
 *   { "cozy coffee shop": "https://images.unsplash.com/photo-...", ... }
 *
 * If neither key is set, the script writes an empty map and img() falls back
 * to its built-in catalog and then a deterministic gradient; no build fails.
 */

import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UNSPLASH_API = "https://api.unsplash.com/search/photos";
const PEXELS_API = "https://api.pexels.com/v1/search";
/**
 * One lookup's ceiling. Short because the whole step runs on the critical path
 * between a finished site and its first preview, and a query that has not
 * answered by now is worth less than the second it would cost to keep waiting.
 */
const TIMEOUT_MS = 2_500;
/**
 * Retried only on an explicit rate-limit reply, where a brief pause genuinely
 * changes the answer. Anything else is retried once at most.
 */
const MAX_RETRIES = 1;
/**
 * Ceiling on the whole batch, independent of how many queries a site has.
 * Whatever has resolved when this expires is written and the rest fall back to
 * the runtime placeholder, so a slow provider costs a plainer site, never a
 * slower one.
 */
// Fifteen seconds, from five: a miss now retries toward its noun, so a page
// of a dozen photographs can be three waves of requests rather than one, and
// the site whose grid came back as gradients was the one that ran out of
// time, not the one that waited.
const TOTAL_BUDGET_MS = 15_000;
/**
 * Enough that a typical site resolves in one or two waves, low enough that a
 * provider is not handed twenty simultaneous requests and asked to throttle.
 */
const CONCURRENCY = 8;

const unsplashKey = process.env.UNSPLASH_ACCESS_KEY ?? "";
const pexelsKey = process.env.PEXELS_API_KEY ?? "";

/** Recursively walk a JSON value and collect every { query, alt } image. */
function collectImageQueries(value, queries = new Set()) {
  if (!value || typeof value !== "object") return queries;
  if (Array.isArray(value)) {
    for (const item of value) collectImageQueries(item, queries);
    return queries;
  }
  if (typeof value.query === "string" && typeof value.alt === "string") {
    queries.add(value.query.trim().toLowerCase());
  }
  for (const item of Object.values(value)) collectImageQueries(item, queries);
  return queries;
}

/**
 * How many photographs a query keeps.
 *
 * A grid asks one query for every item and tells them apart with `sig`, so a
 * query that resolves to a single URL makes every card in the grid show the
 * same photograph. Four attorney portraits came out as two faces, alternating.
 * The provider already returns ten candidates per query and nine were thrown
 * away; six is enough to fill any grid a page actually builds.
 */
const SHORTLIST = 6;

/**
 * The orientation to ask a provider for, from the size a page renders at.
 *
 * Every lookup asked for landscape. A portrait card — 800 by 1000, a
 * person — then got a landscape photograph cropped to a tall box, and the
 * crop took the face with it. The page already says the size it renders;
 * the request follows it.
 */
export function orientationFor(width, height) {
  if (!(width > 0) || !(height > 0)) return "landscape";
  const ratio = height / width;
  if (ratio >= 1.2) return "portrait";
  if (ratio >= 0.85) return "square";
  return "landscape";
}

/**
 * Every img() call in a page, with the size it asked for.
 *
 * The query alone was collected before; the size decides the orientation,
 * and a query used at several sizes keeps the first — one lookup, one
 * shortlist, however many boxes render it.
 */
export function imageCallsIn(source) {
  const calls = [];
  // A plain template literal with no ${} is a literal too; one with an
  // interpolation is not a query anyone can resolve ahead of time.
  for (const match of source.matchAll(
    /\bimg\(\s*(["'`])([^"'`\n]{2,120})\1(?:\s*,\s*(\d+)\s*,\s*(\d+))?/g,
  )) {
    if (match[1] === "`" && match[2].includes("${")) continue;
    calls.push({
      query: match[2].trim().toLowerCase(),
      width: match[3] ? Number(match[3]) : undefined,
      height: match[4] ? Number(match[4]) : undefined,
    });
  }
  return calls;
}

/**
 * A call's arguments from `from` to its closing bracket, split on the
 * commas between them and not on one inside a string or a bracket:
 * `img(String(row.query), 400, 400)` has three, and its size is read. Null
 * when the call does not close within reach.
 */
function scanArguments(source, from) {
  const args = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (let at = from; at < Math.min(source.length, from + 300); at += 1) {
    const char = source[at];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  return null;
}

/**
 * What to search for when the full query finds nothing.
 *
 * A writer names a subject the way a designer would — "hand-poured soy
 * candle on oak shelf" — and a stock library indexes it the way a librarian
 * would. When the whole phrase misses, the tail of it is usually the noun
 * that matters, so the search relaxes toward it: the last two words, then
 * the last one. A photograph of the subject beats an honest gradient; an
 * unrelated photograph does not, which is why it stops at the noun and never
 * reaches for the adjectives on their own.
 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "into",
  "onto",
  "over",
  "under",
  "its",
  "their",
  "this",
  "that",
  "one",
  "two",
  "three",
  "against",
  "beside",
  "near",
  "photo",
  "photograph",
  "picture",
  "image",
  "shot",
  "closeup",
  "view",
  // Words for where a photograph sits on the page, not what it shows. Relaxed
  // to "about", a septic company's About section searched for "about" and got
  // a dentist's photo tagged "About Us".
  "about",
  "our",
  "your",
  "section",
  "hero",
  "banner",
]);

/**
 * The words a stock library can index: no product codes, no sizes, no
 * numerals, no stop words. "Oak No. 04, a 9oz amber candle poured in the
 * studio" is how a designer labels a card; "amber candle poured studio" is
 * what a library can answer.
 */
export function searchWords(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (word) => word.length > 2 && !/\d/.test(word) && !STOP_WORDS.has(word),
    );
}

/**
 * What to search for, in order.
 *
 * The first attempt is the query's own words, all of them, without the noise
 * a library cannot index. When that misses, the search relaxes toward the
 * noun that matters, which is usually at the end: the last two words, then
 * the last one. A photograph of the subject beats an honest gradient; an
 * unrelated photograph does not, which is why it stops at the noun and never
 * reaches for adjectives on their own.
 */
export function relaxedQueries(query, orientation = "landscape") {
  const words = searchWords(query);
  if (words.length === 0) return [query];
  const out = [words.join(" ")];
  if (words.length >= 3) out.push(words.slice(-2).join(" "));
  // A portrait box holds a person. Relaxed to its last noun, "woman founder
  // in linen blazer office" became "office", and the instructor card that
  // asked for a face got a bedroom: a photograph that is confidently wrong
  // is worse than an honest gradient. A person is found by the phrase or
  // its last two words, or not at all.
  if (words.length >= 2 && orientation !== "portrait")
    out.push(words[words.length - 1]);
  return [...new Set(out)];
}

/**
 * A word cut back to its stem, so "trucks" meets "truck" and "pumping" meets
 * "pump". Both sides are cut the same way, so a rough cut is enough.
 */
function singular(word) {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

/**
 * Whether a description's word names a subject's word, once both are cut to
 * their stems.
 *
 * Equal words were all this used to accept, and a security analyst's page
 * shipped as a gradient: the library sent ten photographs of exactly that,
 * described as "cybersecurity professionals" and "analyzing data", and not one
 * said "security" or "analyst". A described compound names its parts
 * ("cybersecurity" is security), and two endings on one stem are one word
 * ("analyst", "analyzing"). Never the other way round: a subject's
 * "whiteboard" is not met by a description's "white", which put a fashion
 * shoot in a threat-modelling section. Five letters in common at least, so
 * "car" never meets "carpet".
 */
function namesWord(said, wanted) {
  if (said === wanted) return true;
  if (wanted.length >= 5 && said.includes(wanted)) return true;
  let shared = 0;
  while (
    shared < said.length &&
    shared < wanted.length &&
    said[shared] === wanted[shared]
  )
    shared += 1;
  return (
    shared >= 5 && said.length - shared <= 3 && wanted.length - shared <= 3
  );
}

/** How many of the subject's words a photograph's own description names. */
export function relevance(subject, description) {
  const said = [
    ...new Set(
      String(description ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2)
        .map(singular),
    ),
  ];
  return searchWords(subject)
    .map(singular)
    .filter((wanted) => said.some((word) => namesWord(word, wanted))).length;
}

/**
 * The candidates worth showing, in the library's own order, or null when
 * none is a photograph of the subject.
 *
 * A stock library matches on tags as well as on what a picture shows, and a
 * septic company's About section came back with a dentist's photo tagged
 * "About Us". Every result also carries a description of what is in the
 * picture, so a candidate is kept only when its description names at least
 * half of the subject's words, rounded up: "septic truck pumping service" no
 * longer settles for a fire truck because both are trucks. Rounded down, one
 * word in three was enough, and a septic site got a swimming pool for "worker
 * with hose in yard" (the pool had a hose) and yellow ventilation hoses for
 * "septic tank pumping truck hose" (a truck, a hose). What passes keeps the
 * library's order: its first result for an everyday subject is its best, and a
 * count of matching words is a cruder judge of a photograph than the
 * library's own. A library that describes none of its results is trusted as
 * before.
 */
export function rankCandidates(subject, candidates) {
  if (!candidates.some((candidate) => candidate.description)) return candidates;
  const needed = Math.max(1, Math.ceil(searchWords(subject).length / 2));
  const kept = candidates.filter(
    (candidate) => relevance(subject, candidate.description) >= needed,
  );
  return kept.length > 0 ? kept : null;
}

/** A description short enough to keep in the report. */
function shortDescription(text) {
  return typeof text === "string" ? text.trim().slice(0, 160) : "";
}

async function fetchJson(url, headers, signal, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      // The batch budget cancels an in-flight lookup as well as pending ones,
      // so one slow provider cannot outlast the ceiling on its own.
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let response;
      try {
        response = await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (!response.ok) {
        if (response.status === 429 && attempt < retries) {
          // Rate limited — wait and retry.
          await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      return await response.json();
    } catch {
      if (signal?.aborted) return null;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

/*
 * Both providers answer the same way: undefined when there is no key, null
 * when the request failed, and otherwise the photographs in the library's own
 * order, which may be none. The order is kept: the library's first result for
 * an everyday subject is its best, and starting each query at a hashed offset
 * into the list put a lesser one first.
 */

async function resolveUnsplash(query, signal, orientation = "landscape") {
  if (!unsplashKey) return undefined;
  const params = new URLSearchParams({
    query,
    per_page: "10",
    orientation: orientation === "square" ? "squarish" : orientation,
  });
  const data = await fetchJson(
    `${UNSPLASH_API}?${params}`,
    { Authorization: `Client-ID ${unsplashKey}`, "Accept-Version": "v1" },
    signal,
  );
  if (!data) return null;
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((photo) => {
    // Use the raw URL with sizing params for consistent cropping.
    const url = new URL(photo.urls.raw);
    url.searchParams.set("auto", "format");
    url.searchParams.set("fit", "crop");
    url.searchParams.set("q", "80");
    return {
      url: url.toString(),
      description: shortDescription(photo.alt_description ?? photo.description),
    };
  });
}

async function resolvePexels(query, signal, orientation = "landscape") {
  if (!pexelsKey) return undefined;
  const params = new URLSearchParams({
    query,
    per_page: "10",
    orientation,
  });
  const data = await fetchJson(
    `${PEXELS_API}?${params}`,
    { Authorization: pexelsKey },
    signal,
  );
  if (!data) return null;
  const photos = Array.isArray(data.photos) ? data.photos : [];
  return photos
    .map((photo) => ({
      url:
        photo.src?.large2x ?? photo.src?.large ?? photo.src?.original ?? null,
      description: shortDescription(photo.alt),
    }))
    .filter(
      (candidate) =>
        typeof candidate.url === "string" && candidate.url.length > 0,
    );
}

/**
 * Pexels first, Unsplash second.
 *
 * Not a quality judgement: the Unsplash key is on the Demo tier, which allows
 * fifty requests an hour in total. A single site asks for around twenty images,
 * so leading with Unsplash exhausts the hour's allowance after two sites and
 * then spends a wasted round trip per query discovering that. Pexels allows
 * 25,000 a month, which covers roughly a thousand sites, so it leads and
 * Unsplash covers what it misses.
 */
const providers = [
  ["pexels", resolvePexels],
  ["unsplash", resolveUnsplash],
];

/**
 * The shortlist for one subject, or null. Every search it makes lands in
 * `tries` — what was searched, where, how many photographs came back and how
 * many described the subject — so a gradient on a live site can be traced
 * to the search that missed instead of re-run by hand to find out.
 */
async function resolveQuery(query, signal, orientation = "landscape", tries) {
  for (const attempt of relaxedQueries(query, orientation)) {
    for (const [provider, search] of providers) {
      if (signal?.aborted) return null;
      const candidates = await search(attempt, signal, orientation);
      if (candidates === undefined) continue;
      // Judged against the whole subject, not the relaxed search: a photo
      // found by "truck" must still be a truck the query asked for.
      const ranked =
        candidates && candidates.length > 0
          ? rankCandidates(query, candidates)
          : null;
      tries?.push({
        search: attempt,
        provider,
        returned: candidates?.length ?? 0,
        kept: ranked?.length ?? 0,
        ...(candidates === null ? { failed: true } : {}),
      });
      // Every candidate the search ranked, not only the shortlist: when the
      // address check drops one, the next is already here, with no search.
      if (ranked) return ranked;
    }
  }
  return null;
}

/**
 * One address check's ceiling. Two waves of 30 HEADs at once to the real
 * Pexels image host on 11 November answered at a median of 0.40 s (cached)
 * and 0.71 s (not cached), the slowest in 1.05 s
 * (investigations/2026-11-11/photos-for-saved-rows/review-4/04-real-host-cold-variants.out.txt).
 */
const CHECK_TIMEOUT_MS = 2_000;
/** The whole check pass, however many addresses a site has. */
const CHECK_BUDGET_MS = 3_000;
/**
 * The pass never runs past this, counted from the start of the process: the
 * sandbox stops the script at 18 s, and a stopped script writes no map, so
 * a search that used its whole 15 s leaves the check what is left.
 */
const CHECK_DEADLINE_MS = 16_500;
/**
 * Checks under way at once. In the same file, both waves of 30 at once were
 * answered 200 image/jpeg, none refused.
 */
const CHECK_CONCURRENCY = 32;
/**
 * A host is given up when this many checks on it went unanswered (a timeout
 * or a network error) and nothing from it has answered since the pass
 * started. One answer is enough to keep a host: a healthy slow host whose
 * checks time out together among answers is never given up.
 */
const HOST_GIVE_UP = 5;
/** The answers that say for certain an address serves no picture. */
const GONE_STATUSES = new Set([400, 404, 410, 422]);

/**
 * @typedef {{ now: () => number, setTimeout: (run: () => void, ms: number) => unknown, clearTimeout: (id: any) => void }} Clock
 */

/** @type {Clock} */
const realClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/** A HEAD of the address: its status and type, after redirects. */
async function headRequest(url, signal) {
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    signal,
  });
  await response.body?.cancel().catch(() => {});
  return {
    status: response.status,
    type: response.headers.get("content-type"),
  };
}

/**
 * The types a 2xx answers with when it is a page or a message, not a
 * picture: an error page, a text body, JSON or XML.
 */
const NOT_A_PICTURE =
  /^\s*(?:text\/|application\/(?:json|xml|xhtml\+xml)\s*(?:;|$))/i;

/**
 * "loads", "gone" (dropped) or "unsure" (the host answered, and said neither:
 * a refusal, a rate limit, a server error, a 2xx with no type or a generic
 * one such as application/octet-stream, which some hosts send for real
 * pictures). A host may refuse a server and still serve browsers, so only
 * "gone" drops a photo.
 */
function verdictOf({ status, type }) {
  if (status >= 200 && status < 300) {
    if (type && /^\s*image\//i.test(type)) return "loads";
    return type && NOT_A_PICTURE.test(type) ? "gone" : "unsure";
  }
  return GONE_STATUSES.has(status) ? "gone" : "unsure";
}

/**
 * Asks each new photo's address once whether it loads, after searching is
 * done, and keeps per subject the first `wanted` candidates, in the
 * library's order, that did not answer "gone".
 *
 * A library's search can hand out an address its own host no longer serves:
 * a café's "cinnamon roll pastry" got Pexels photo 27244307, which answers
 * 422, and the page showed a broken image. Searching is not touched by this:
 * it runs after, on what the searches returned, and a dropped photo is
 * replaced by the next candidate of the same search.
 *
 * Only a definite answer drops a photo. A timeout, a network error, a host
 * given up and a check the budget cut keep it, and are counted as unchecked.
 * The first photos of every subject are asked before the second ones, so a
 * budget that runs out leaves the least-shown photos unchecked.
 *
 * @param {Record<string, Array<{ url: string, description: string }>>} shortlists
 * @param {{ request?: (url: string, signal: AbortSignal) => Promise<{ status: number, type: string | null }>, clock?: Clock, timeoutMs?: number, budgetMs?: number, concurrency?: number, giveUpAfter?: number, wanted?: number }} [options]
 */
export async function checkShortlists(shortlists, options = {}) {
  const {
    request = headRequest,
    clock = realClock,
    timeoutMs = CHECK_TIMEOUT_MS,
    budgetMs = CHECK_BUDGET_MS,
    concurrency = CHECK_CONCURRENCY,
    giveUpAfter = HOST_GIVE_UP,
    wanted = SHORTLIST,
  } = options;
  const startedAt = clock.now();
  /**
   * What each address answered: loads, gone or unsure; or silent (asked, no
   * answer), skipped (its host was given up) or budget (cut, or never asked).
   */
  const verdicts = new Map();
  const hosts = new Map();
  const hostOf = (url) => {
    let name = "";
    try {
      name = new URL(url).host;
    } catch {}
    if (!hosts.has(name)) hosts.set(name, { answered: false, unanswered: 0 });
    return hosts.get(name);
  };
  const givenUp = (host) => !host.answered && host.unanswered >= giveUpAfter;

  // Per subject: the candidates still in the running, and how far the check
  // has got along them.
  const subjects = Object.entries(shortlists).map(([query, candidates]) => ({
    query,
    candidates,
    next: Math.min(wanted, candidates.length),
  }));
  // First photos of every subject, then second photos, and so on.
  const queue = [];
  const longest = Math.max(0, ...subjects.map((one) => one.next));
  for (let rank = 0; rank < longest; rank += 1)
    for (const subject of subjects)
      if (rank < subject.next) queue.push(subject.candidates[rank].url);

  let requested = 0;
  let budgetReached = budgetMs <= 0;
  /** @type {Set<() => void>} */
  const cutters = new Set();
  const budgetTimer = budgetReached
    ? null
    : clock.setTimeout(() => {
        budgetReached = true;
        for (const cut of cutters) cut();
      }, budgetMs);

  /**
   * Asks one address, unless it was asked already or the budget or its host
   * is spent; true when this call asked it.
   */
  const ask = async (url) => {
    if (verdicts.has(url) || budgetReached) return false;
    const host = hostOf(url);
    if (givenUp(host)) {
      verdicts.set(url, "skipped");
      return false;
    }
    verdicts.set(url, "asking");
    requested += 1;
    const controller = new AbortController();
    let cut;
    const stopped = new Promise((resolve) => {
      cut = resolve;
    });
    const stop = () => {
      controller.abort();
      cut("stopped");
    };
    cutters.add(stop);
    const timer = clock.setTimeout(stop, timeoutMs);
    let answer = "stopped";
    try {
      answer = await Promise.race([request(url, controller.signal), stopped]);
    } catch {
      answer = "failed";
    } finally {
      clock.clearTimeout(timer);
      cutters.delete(stop);
    }
    if (answer && typeof answer === "object") {
      host.answered = true;
      verdicts.set(url, verdictOf(answer));
    } else if (budgetReached) {
      verdicts.set(url, "budget");
    } else {
      host.unanswered += 1;
      verdicts.set(url, "silent");
    }
    return true;
  };

  const replacements = [];
  const worker = async () => {
    for (;;) {
      if (budgetReached) return;
      const url = replacements.shift() ?? queue.shift();
      if (url === undefined) return;
      if (!(await ask(url)) || verdicts.get(url) !== "gone") continue;
      // A gone photo makes room for the next candidate of every subject
      // whose photos it was among, once.
      for (const subject of subjects) {
        const at = subject.candidates.findIndex((one) => one.url === url);
        if (at === -1 || at >= subject.next) continue;
        // The next candidate not already known to be gone.
        while (subject.next < subject.candidates.length) {
          const following = subject.candidates[subject.next].url;
          subject.next += 1;
          if (verdicts.get(following) === "gone") continue;
          replacements.push(following);
          break;
        }
      }
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, () => worker()),
    );
  } finally {
    if (budgetTimer !== null) clock.clearTimeout(budgetTimer);
  }

  /** @type {Record<string, Array<{ url: string, description: string }>>} */
  const kept = {};
  /** @type {Record<string, number>} */
  const dropped = {};
  /** @type {Record<string, number>} */
  const unchecked = {};
  const summary = {
    asked: 0,
    loads: 0,
    dropped: 0,
    unchecked: { budget: 0, unanswered: 0, hostGivenUp: 0, unsure: 0 },
    budgetReached,
    ms: clock.now() - startedAt,
  };
  for (const { query, candidates } of subjects) {
    const live = [];
    for (const candidate of candidates) {
      if (live.length >= wanted) break;
      const verdict = verdicts.get(candidate.url) ?? "budget";
      if (verdict === "gone") {
        dropped[query] = (dropped[query] ?? 0) + 1;
        summary.dropped += 1;
        continue;
      }
      live.push(candidate);
      if (verdict === "loads") summary.loads += 1;
      else {
        unchecked[query] = (unchecked[query] ?? 0) + 1;
        if (verdict === "unsure") summary.unchecked.unsure += 1;
        else if (verdict === "silent") summary.unchecked.unanswered += 1;
        else if (verdict === "skipped") summary.unchecked.hostGivenUp += 1;
        else summary.unchecked.budget += 1;
      }
    }
    if (live.length > 0) kept[query] = live;
  }
  summary.asked = requested;
  return { kept, dropped, unchecked, summary };
}

/**
 * Moves each subject's first photograph off one another subject already
 * opens with, when its shortlist has another.
 *
 * Keeping the library's order means two sections asking for nearly the same
 * thing ("septic tank pumping", "septic tank inspection") get the same first
 * result, and a page showing one photograph twice reads as a template. The
 * subjects are taken in sorted order, after those `taken` by an earlier run,
 * so the outcome does not depend on which lookup answered first.
 *
 * @param {Record<string, Array<{ url: string, description: string }>>} found
 * @param {Set<string>} [taken]
 * @returns {Record<string, Array<{ url: string, description: string }>>}
 */
export function spreadFirstPhotos(found, taken = new Set()) {
  const used = new Set(taken);
  /** @type {Record<string, Array<{ url: string, description: string }>>} */
  const out = {};
  for (const query of Object.keys(found).sort()) {
    const shortlist = found[query];
    const index = shortlist.findIndex((photo) => !used.has(photo.url));
    const ordered =
      index > 0
        ? [shortlist[index], ...shortlist.filter((_, at) => at !== index)]
        : shortlist;
    if (ordered.length > 0) used.add(ordered[0].url);
    out[query] = ordered;
  }
  return out;
}

/** A stored entry is a list; older maps hold a single string. */
function usableEntry(value) {
  if (typeof value === "string" && value.length > 0) return [value];
  if (Array.isArray(value)) {
    const urls = value.filter(
      (url) => typeof url === "string" && url.length > 0,
    );
    if (urls.length > 0) return urls;
  }
  return null;
}

/** Runs tasks with a bounded number in flight, preserving completion order. */
async function mapWithConcurrency(items, limit, task) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await task(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Every img() call whose subject is computed rather than written out:
 * `img(room.query, 900, 700, index)`. The literal collector cannot see one,
 * because there is no string in the source to read — and a section that
 * drives its pictures from an array is how a rooms grid, a menu, or a
 * gallery is actually written. A hotel shipped with three photographs and
 * thirteen gradients for exactly this reason, and reported no misses,
 * because a call nobody collected is a call nobody counts.
 *
 * The sizes are still literal, so the boxes can still say which orientation
 * they want.
 */
export function dynamicImageCallsIn(source) {
  const calls = [];
  for (const match of source.matchAll(/\bimg\(/g)) {
    const args = scanArguments(source, match.index + match[0].length);
    if (!args) continue;
    const subject = args[0] ?? "";
    if (!subject) continue;
    // A plain literal is the collector's own business; a template literal
    // with an interpolation is not one, whatever it looks like.
    const literal =
      /^(["']).*\1$/.test(subject) ||
      (subject.startsWith("`") && !subject.includes("${"));
    if (literal) continue;
    const width = Number(args[1]);
    const height = Number(args[2]);
    calls.push({
      subject,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    });
  }
  return calls;
}

/**
 * A computed subject split into what it reads and the subject written after
 * it for when that is empty: `r.listings?.image_query ?? "designer garment"`
 * reads `r.listings?.image_query` and falls back to "designer garment".
 * Without a fallback the whole subject is what it reads.
 *
 * @param {string} subject
 * @returns {{ read: string, fallback?: string }}
 */
export function subjectParts(subject) {
  const split = /^(.+?)\s*(?:\?\?|\|\|)\s*(["'`])([^"'`\n]{2,120})\2$/.exec(
    subject,
  );
  if (!split || (split[2] === "`" && split[3].includes("${")))
    return { read: plainRead(subject) };
  return {
    read: plainRead(split[1]),
    fallback: split[3].trim().toLowerCase(),
  };
}

/**
 * What an expression reads once the guards around it are taken off. The
 * description column is empty for rows people add, so its type allows
 * null and a builder guards the read: `row.image_query!`, `row.image_query
 * as string`, `row.image_query ?? ""`, `String(row.image_query)`, or one
 * inside brackets. Each still reads `row.image_query`.
 */
function plainRead(expression) {
  let read = expression.trim();
  for (;;) {
    const next = read
      .replace(/^\((.*)\)$/s, "$1")
      .replace(/^String\((.*)\)$/s, "$1")
      .replace(/\s+as\s+[A-Za-z_$][\w$<>[\]|. ]*$/, "")
      .replace(/!$/, "")
      .replace(/\s*(?:\?\?|\|\|)\s*(["'`])[^"'`\n]?\1$/, "")
      .trim();
    if (next === read) return read;
    read = next;
  }
}

/** The field names a subject kept in data has always been read from. */
const KNOWN_IMAGE_FIELDS = ["query", "imageQuery", "photo", "image"];

/**
 * The fields a file's computed img() calls read their subjects from:
 * `img(member.avatarQuery, 64, 64, i)` reads `avatarQuery`. A writer names
 * that field as they please, and whatever they called it, its values are
 * what the page will ask img() for. Only a plain property read counts; a
 * bare name, an index or a function call names no field. A read with a
 * written fallback (`row.image_query ?? "garment"`) still reads its field.
 *
 * @param {Array<{ subject: string }>} calls
 * @returns {string[]}
 */
export function imageFieldsIn(calls) {
  const fields = [];
  for (const { subject } of calls) {
    const { read } = subjectParts(subject);
    if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/.test(read))
      fields.push(read.slice(read.lastIndexOf(".") + 1));
  }
  return [...new Set(fields)];
}

/**
 * A SQL file as the pieces a statement is made of, in order, with its
 * comments left out: words, quoted names, strings (as their values),
 * numbers and single marks. Read by hand rather than by pattern, because a
 * starter row's description can hold anything a pattern would trip on: a
 * doubled quote ("Prada''s"), a semicolon, a comment marker, a bracket.
 * A string that never closes runs to the end of the file, which leaves the
 * row it opened unfinished and so unread.
 *
 * @param {string} sql
 * @returns {Array<{ kind: "word" | "name" | "string" | "number" | "mark", value: string }>}
 */
function sqlTokens(sql) {
  const tokens = [];
  const length = sql.length;
  /** A '…' string from its opening quote; E'…' strings also take backslashes. */
  const quoted = (from, escapes) => {
    let value = "";
    let at = from + 1;
    while (at < length) {
      const char = sql[at];
      if (escapes && char === "\\") {
        const next = sql[at + 1] ?? "";
        value += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[next] ?? next;
        at += 2;
        continue;
      }
      if (char === "'") {
        if (sql[at + 1] === "'") {
          value += "'";
          at += 2;
          continue;
        }
        return { value, end: at + 1 };
      }
      value += char;
      at += 1;
    }
    return { value, end: length };
  };
  // Sticky, so a word is read where it starts without copying the rest.
  const wordPattern = /[A-Za-z0-9_$\u0080-\uffff]+/y;
  const numberPattern = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let at = 0;
  const readAt = (pattern) => {
    pattern.lastIndex = at;
    return pattern.exec(sql)?.[0] ?? sql[at];
  };
  while (at < length) {
    const char = sql[at];
    const next = sql[at + 1];
    if (/\s/.test(char)) {
      at += 1;
    } else if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", at);
      at = end === -1 ? length : end + 1;
    } else if (char === "/" && next === "*") {
      // Postgres nests block comments.
      let depth = 1;
      at += 2;
      while (at < length && depth > 0) {
        if (sql[at] === "/" && sql[at + 1] === "*") {
          depth += 1;
          at += 2;
        } else if (sql[at] === "*" && sql[at + 1] === "/") {
          depth -= 1;
          at += 2;
        } else at += 1;
      }
    } else if ((char === "E" || char === "e") && next === "'") {
      const read = quoted(at + 1, true);
      tokens.push({ kind: "string", value: read.value });
      at = read.end;
    } else if (char === "'") {
      const read = quoted(at, false);
      tokens.push({ kind: "string", value: read.value });
      at = read.end;
    } else if (char === '"') {
      let value = "";
      at += 1;
      while (at < length) {
        if (sql[at] === '"') {
          if (sql[at + 1] !== '"') break;
          at += 1;
        }
        value += sql[at];
        at += 1;
      }
      tokens.push({ kind: "name", value });
      at += 1;
    } else if (char === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
        sql.slice(at, at + 66),
      );
      if (tag) {
        const close = sql.indexOf(tag[0], at + tag[0].length);
        const end = close === -1 ? length : close;
        tokens.push({
          kind: "string",
          value: sql.slice(at + tag[0].length, end),
        });
        at = close === -1 ? length : close + tag[0].length;
      } else {
        // A parameter such as $1: nothing a row can hold as a description.
        const parameter = /^\$\d*/.exec(sql.slice(at, at + 12))?.[0] ?? "$";
        tokens.push({ kind: "mark", value: parameter });
        at += parameter.length;
      }
    } else if (/[A-Za-z_\u0080-\uffff]/.test(char)) {
      const word = readAt(wordPattern);
      tokens.push({ kind: "word", value: word });
      at += word.length;
    } else if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(next))) {
      const number = readAt(numberPattern);
      tokens.push({ kind: "number", value: number });
      at += number.length;
    } else if (char === ":" && next === ":") {
      tokens.push({ kind: "mark", value: "::" });
      at += 2;
    } else {
      tokens.push({ kind: "mark", value: char });
      at += 1;
    }
  }
  return tokens;
}

/**
 * The string a row's value holds, or null when the value is anything else.
 * `'quilted leather handbag'`, `E'…'`, `$$…$$`, `'…'::text` and
 * `cast('…' as text)` are strings; NULL, a number, a function call, an
 * array or two strings joined are not.
 */
function rowString(tokens) {
  const isMark = (token, value) =>
    token?.kind === "mark" && token.value === value;
  const isType = (token) =>
    token.kind === "word" ||
    token.kind === "number" ||
    (token.kind === "mark" && "()[]".includes(token.value));
  const [first, second] = tokens;
  if (first?.kind === "string") {
    if (tokens.length === 1) return first.value;
    if (isMark(second, "::") && tokens.slice(2).every(isType))
      return first.value;
    return null;
  }
  if (
    first?.kind === "word" &&
    first.value.toLowerCase() === "cast" &&
    isMark(second, "(") &&
    tokens[2]?.kind === "string" &&
    tokens[3]?.kind === "word" &&
    tokens[3].value.toLowerCase() === "as" &&
    isMark(tokens.at(-1), ")") &&
    tokens.slice(4, -1).every(isType)
  )
    return tokens[2].value;
  return null;
}

/** `imageQuery` and `image_query` are one name; so are their other cases. */
function snakeName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * The descriptions of the saved rows' file that a photo library can be
 * asked for: strings of two to 120 characters on one line, not an address
 * or a file name, lowercased, each once.
 */
function savedDescriptions(values) {
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(
          (value) =>
            value.length >= 2 &&
            value.length <= 120 &&
            !/[\n\r]/.test(value) &&
            !/:\/\/|^\/|\.(png|jpe?g|svg|webp|avif|gif)$/i.test(value),
        )
        .map((value) => value.toLowerCase()),
    ),
  ];
}

/**
 * The photo descriptions a seed file's starter rows hold in the given
 * columns.
 *
 * A thing kept in the database — a listing, a product, a room — is shown
 * with `img(listing.image_query, 800, 1000, index)`, and its description is
 * written nowhere in the code: it is in the row. thatcode copies the rows
 * the builder inserted into `supabase/seed.sql`, so they are on disk when
 * the photographs are looked up. A rental marketplace on production had
 * eight starter listings in that file and one photograph in the whole app,
 * because nothing here read SQL.
 *
 * Read from `insert into … (columns) values (…), (…)` only, anywhere in a
 * statement (inside a WITH too: sample rows added after a first build are
 * often written in one statement with the rows they link to). A statement
 * with no column list, or one that inserts what a select returns, is
 * skipped: a select's items cannot be matched to the columns by position
 * (a star expands to several, a filter drops rows, and a column read from
 * a list, a function or a table can be a brand's bio under the photo
 * column's name). A column counts when it is one of
 * `fields` (the fields the page's own computed calls read), by its exact
 * name or as the same name in camelCase or snake_case; nothing else in the
 * file is taken for a photograph. Values pass the filter a description in
 * data passes (`dataImageQueriesIn`). SQL that cannot be read gives what
 * was read before it, never an error.
 *
 * @param {string} sql
 * @param {string[]} fields
 * @returns {string[]}
 */
export function seedImageQueriesIn(sql, fields) {
  const wanted = new Set(fields.map(snakeName));
  const queries = [];
  if (wanted.size === 0 || typeof sql !== "string") return queries;
  try {
    const tokens = sqlTokens(sql);
    const word = (token, value) =>
      token?.kind === "word" && token.value.toLowerCase() === value;
    const mark = (token, value) =>
      token?.kind === "mark" && token.value === value;
    const statements = [[]];
    for (const token of tokens) {
      if (mark(token, ";")) statements.push([]);
      else statements.at(-1).push(token);
    }
    for (const statement of statements) {
      // Every `insert into t (columns) values`, inside a WITH too.
      for (let start = 0; start < statement.length; start += 1) {
        if (
          !word(statement[start], "insert") ||
          !word(statement[start + 1], "into")
        )
          continue;
        let at = start + 2;
        // The table, schema-qualified or quoted.
        let named = false;
        while (
          statement[at]?.kind === "word" ||
          statement[at]?.kind === "name"
        ) {
          named = true;
          at += 1;
          if (!mark(statement[at], ".")) break;
          at += 1;
        }
        if (!named) continue;
        if (word(statement[at], "as")) at += 2;
        if (!mark(statement[at], "(")) continue;
        at += 1;
        const columns = [];
        while (
          statement[at]?.kind === "word" ||
          statement[at]?.kind === "name"
        ) {
          columns.push(statement[at].value);
          at += 1;
          if (!mark(statement[at], ",")) break;
          at += 1;
        }
        if (!mark(statement[at], ")")) continue;
        at += 1;
        if (word(statement[at], "overriding")) at += 3;
        if (!word(statement[at], "values")) continue;
        at += 1;
        const read = columns
          .map((column, index) => (wanted.has(snakeName(column)) ? index : -1))
          .filter((index) => index >= 0);
        if (read.length === 0) continue;
        // Each row, until what follows the last one (on conflict, returning).
        while (mark(statement[at], "(")) {
          const values = [];
          let value = [];
          let depth = 0;
          let closed = false;
          at += 1;
          for (; at < statement.length; at += 1) {
            const token = statement[at];
            if (mark(token, "(") || mark(token, "[")) depth += 1;
            else if (mark(token, ")") || mark(token, "]")) {
              if (depth === 0) {
                closed = mark(token, ")");
                break;
              }
              depth -= 1;
            } else if (depth === 0 && mark(token, ",")) {
              values.push(rowString(value));
              value = [];
              continue;
            }
            value.push(token);
          }
          if (!closed) break;
          values.push(rowString(value));
          for (const index of read) {
            const text = values[index];
            if (typeof text === "string") queries.push(text);
          }
          at += 1;
          if (!mark(statement[at], ",")) break;
          at += 1;
        }
      }
    }
  } catch {
    // What was read before the SQL stopped making sense is kept.
  }
  return [
    ...new Set(
      queries
        .map((query) => query.trim())
        .filter(
          (query) =>
            query.length >= 2 &&
            query.length <= 120 &&
            !/[\n\r]/.test(query) &&
            !/:\/\/|^\/|\.(png|jpe?g|svg|webp|avif|gif)$/i.test(query),
        )
        .map((query) => query.toLowerCase()),
    ),
  ];
}

/**
 * The subjects a page keeps in data rather than in the call.
 *
 * A writer who drives a grid from an array still names each picture in it —
 * `{ name: "Caldera View Suite", query: "cave suite hot tub sunset" }` — so
 * the string a library can answer is in the file, one hop from the img()
 * call that renders it. Read only in files that make a computed call, so a
 * `query:` belonging to something else entirely is never mistaken for a
 * photograph.
 *
 * Values that name a file or a URL are somebody's asset, not a search.
 *
 * `fields` are the fields the file's own computed calls read
 * (`imageFieldsIn`), beside the four names always known. A dashboard kept
 * its people's pictures under `avatarQuery`, none of the four, so nothing
 * was looked up and five people shared two faces.
 *
 * @param {string} source
 * @param {string[]} [fields]
 */
export function dataImageQueriesIn(source, fields = []) {
  const queries = [];
  const names = [...new Set([...KNOWN_IMAGE_FIELDS, ...fields])]
    .map((name) => name.replaceAll("$", "\\$"))
    .join("|");
  for (const match of source.matchAll(
    new RegExp(
      `(?:\\b(?:${names})|["'](?:${names})["'])\\s*:\\s*(["'])([^"'\\n]{2,120})\\1`,
      "g",
    ),
  )) {
    const value = match[2].trim();
    if (/:\/\/|^\/|\.(png|jpe?g|svg|webp|avif|gif)$/i.test(value)) continue;
    queries.push(value.toLowerCase());
  }
  return [...new Set(queries)];
}

/**
 * The subjects a page writes straight into the array it maps.
 *
 * `{["handmade ceramic mugs shelf", "pink glazed vase"].map((query, index) =>
 * <img src={img(query, 500, 500, index)} />)}` names its photographs as
 * plainly as an object with a `query` field does, only with nothing to key
 * on. The strings are collected when the callback's own parameter is what
 * the img() call renders, so an array of tab labels beside it is never
 * mistaken for a list of photographs.
 *
 * Both shapes are read: the array written where it is mapped, and the one
 * declared above under a name.
 */
export function mappedArrayQueriesIn(source, subjects = new Set()) {
  const queries = [];
  const strings = (block) =>
    [...block.matchAll(/(["'])([^"'\n]{2,120})\1/g)].map((match) => match[2]);

  // [ "…", "…" ].map((query, index) => … img(query, …)
  for (const match of source.matchAll(
    /\[([^[\]]{0,2000})\]\s*\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)/g,
  )) {
    if (!subjects.has(match[2])) continue;
    queries.push(...strings(match[1]));
  }

  // const PIECES = [ "…", "…" ]; … PIECES.map((query, index) => …
  for (const match of source.matchAll(
    /\b([A-Za-z_$][\w$]*)\s*\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)/g,
  )) {
    if (!subjects.has(match[2])) continue;
    const declaration = new RegExp(
      `\\b(?:const|let|var)\\s+${match[1]}\\b[^=]{0,80}=\\s*\\[([^\\]]{0,2000})\\]`,
    ).exec(source);
    if (declaration) queries.push(...strings(declaration[1]));
  }

  return [
    ...new Set(
      queries
        .map((query) => query.trim().toLowerCase())
        // A subject a library can answer, not a path, a class list or a word.
        .filter(
          (query) =>
            query.split(/\s+/).length >= 2 &&
            !/:\/\/|^\/|\.(png|jpe?g|svg|webp|avif|gif)$/i.test(query),
        ),
    ),
  ];
}

/**
 * The project modules a file imports, as written.
 *
 * A writer who drives a grid from an array usually keeps the array in its own
 * module — `src/lib/hotel-data.ts` — and imports it into the page that
 * renders it. That module makes no img() call of its own and lives under
 * `lib`, which this script does not walk, so the subjects it holds were
 * invisible twice over. Only project-relative specifiers are returned: a
 * package has no photographs of ours in it.
 */
export function projectImportsIn(source) {
  const specifiers = [];
  for (const match of source.matchAll(
    /\bfrom\s*(["'])((?:@\/|\.\.?\/)[^"'\n]{1,200})\1/g,
  )) {
    specifiers.push(match[2]);
  }
  return [...new Set(specifiers)];
}

/** Local JSX names for a module, including default and aliased imports. */
function componentImportsIn(source) {
  const imports = [];
  for (const match of source.matchAll(
    /\bimport\s+([^;]+?)\s+from\s*(["'])((?:@\/|\.\.?\/)[^"'\n]{1,200})\2/g,
  )) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const names = [];
    const defaultName = /^([A-Z][\w$]*)\s*(?:,|$)/.exec(clause)?.[1];
    if (defaultName) names.push(defaultName);
    const named = /\{([^}]+)\}/.exec(clause)?.[1] ?? "";
    for (const binding of named.split(",")) {
      if (binding.trim().startsWith("type ")) continue;
      const local = binding
        .trim()
        .split(/\s+as\s+/)
        .at(-1);
      if (/^[A-Z][\w$]*$/.test(local ?? "")) names.push(local);
    }
    imports.push({ specifier: match[3], names });
  }
  return imports;
}

/** Every source file a page's photographs could be named in. */
async function sourceFiles(root, depth = 0) {
  if (depth > 6) return [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // `lib` holds img() itself, whose comments are full of example
      // queries; `content` holds the map this script writes.
      if (["lib", "content", "node_modules", "assets"].includes(entry.name))
        continue;
      files.push(...(await sourceFiles(full, depth + 1)));
      continue;
    }
    if (
      entry.isFile() &&
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))
    )
      files.push(full);
  }
  return files;
}

/**
 * A file-based site carries its photo queries in source rather than in the
 * blueprint: `img("elegant law office")` in a page or a custom section. The
 * same map serves both, so a page written by the agent gets a real photograph
 * the way a blueprint section does.
 *
 * Walked rather than listed: the three flat directories missed a component
 * one folder deeper, and a site that organises itself lost its pictures for
 * being tidy.
 */
/**
 * Where a specifier lands, or null when it is not a file we can read. The
 * template's `@/` is its own `src`; extensions are implied.
 */
async function resolveProjectImport(specifier, fromFile, srcRoot) {
  const base = specifier.startsWith("@/")
    ? path.join(srcRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".ts") && !candidate.endsWith(".tsx")) continue;
    // img.ts documents itself with example queries; reading it would invent
    // photographs no section asked for.
    if (path.basename(candidate) === "img.ts") continue;
    const relative = path.relative(srcRoot, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) continue;
    try {
      const resolved = await realpath(candidate);
      const realRelative = path.relative(srcRoot, resolved);
      if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`))
        continue;
      return resolved;
    } catch {}
  }
  return null;
}

async function collectSourceImageQueries(
  queries = new Set(),
  orientations = new Map(),
) {
  const srcRoot = await realpath("src");
  const stats = {
    dynamicCalls: 0,
    dataQueries: 0,
    blindFiles: [],
    importedFiles: 0,
    seedQueries: 0,
    savedPending: [],
    savedRowsFrom: "none",
  };
  // A file of the project, links followed, only when it is inside the
  // project, as the app's source is: nothing outside it is ever sent out as
  // a search. Null when it is absent or outside.
  const projectFile = async (file) => {
    try {
      const projectRoot = await realpath(".");
      const real = await realpath(file);
      const inside = path.relative(projectRoot, real);
      if (
        inside &&
        inside !== ".." &&
        !inside.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(inside)
      )
        return await readFile(real, "utf-8");
    } catch {
      // Absent: nothing to read.
    }
    return null;
  };
  // The saved rows' descriptions, from one of two places. First the file
  // thatcode writes from the app's database once a build or a change is
  // done (src/content/photo-descriptions.json, `{ "image_query": [...] }`):
  // the rows a visitor may read, as the database holds them now. Only when
  // there is no such file, the starter rows thatcode keeps beside the app
  // (seedImageQueriesIn), as an app built before that file reads them. A
  // file without the field means the database has none: a starter row
  // deleted or locked since must not come back from the seed.
  const savedText = await projectFile("src/content/photo-descriptions.json");
  let saved = {};
  let seed = "";
  if (savedText !== null) {
    stats.savedRowsFrom = "file";
    try {
      const parsed = JSON.parse(savedText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        saved = parsed;
    } catch {
      // Not what thatcode writes: no descriptions.
    }
  } else {
    seed = (await projectFile("supabase/seed.sql")) ?? "";
    if (seed) stats.savedRowsFrom = "seed";
  }
  const seedQueries = new Map();
  const seedFor = (field) => {
    if (!seedQueries.has(field)) {
      const values = Object.hasOwn(saved, snakeName(field))
        ? saved[snakeName(field)]
        : [];
      seedQueries.set(
        field,
        savedText !== null
          ? Array.isArray(values)
            ? savedDescriptions(values)
            : []
          : seed
            ? seedImageQueriesIn(seed, [field])
            : [],
      );
    }
    return seedQueries.get(field);
  };
  const fromSeed = new Set();
  // Cache modules before visiting their dependencies: barrels and context
  // modules often form cycles. Never execute generated code to find images.
  const modules = new Map();
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    let source;
    try {
      source = await readFile(file, "utf-8");
    } catch {
      return null;
    }
    const module = { source, imports: [], components: new Map() };
    modules.set(file, module);
    for (const specifier of projectImportsIn(source)) {
      const imported = await resolveProjectImport(specifier, file, srcRoot);
      if (imported && (await load(imported))) module.imports.push(imported);
    }
    for (const { specifier, names } of componentImportsIn(source)) {
      const imported = await resolveProjectImport(specifier, file, srcRoot);
      if (imported) module.components.set(imported, names);
    }
    return module;
  }
  for (const file of await sourceFiles(srcRoot)) await load(file);

  function collectDependencies(file, subjects, named, visited, fields) {
    if (visited.has(file)) return;
    visited.add(file);
    const module = modules.get(file);
    if (!module) return;
    const before = named.size;
    for (const query of dataImageQueriesIn(module.source, fields))
      named.add(query);
    for (const query of mappedArrayQueriesIn(module.source, subjects))
      named.add(query);
    if (named.size > before) stats.importedFiles += 1;
    for (const imported of module.imports)
      collectDependencies(imported, subjects, named, visited, fields);
  }

  for (const [file, module] of modules) {
    const { source } = module;
    for (const call of imageCallsIn(source)) {
      queries.add(call.query);
      if (!orientations.has(call.query))
        orientations.set(call.query, orientationFor(call.width, call.height));
    }
    const dynamic = dynamicImageCallsIn(source);
    if (dynamic.length === 0) continue;
    stats.dynamicCalls += dynamic.length;
    const orientation = orientationFor(dynamic[0].width, dynamic[0].height);
    // A subject written after the read, for when the field is empty, is a
    // photograph the page shows like any written in a call.
    for (const call of dynamic) {
      const { fallback } = subjectParts(call.subject);
      if (!fallback) continue;
      queries.add(fallback);
      if (!orientations.has(fallback))
        orientations.set(fallback, orientationFor(call.width, call.height));
    }
    const subjects = new Set(
      dynamic
        .map((call) => subjectParts(call.subject).read)
        .filter((subject) => /^[A-Za-z_$][\w$]*$/.test(subject)),
    );
    // The fields these calls read, whatever the writer named them.
    const fields = imageFieldsIn(dynamic);
    const named = new Set([
      ...dataImageQueriesIn(source, fields),
      ...mappedArrayQueriesIn(source, subjects),
    ]);
    // A field these calls read that the starter rows fill, each description
    // in the orientation of the first call reading it.
    for (const field of fields) {
      const call = dynamic.find((one) => imageFieldsIn([one]).includes(field));
      for (const query of seedFor(field)) {
        named.add(query);
        fromSeed.add(query);
        if (!orientations.has(query))
          orientations.set(query, orientationFor(call?.width, call?.height));
      }
    }

    const visited = new Set([file]);
    for (const imported of module.imports)
      collectDependencies(imported, subjects, named, visited, fields);

    // A presentational card has no data import at all. Its rendering parent
    // passes the object used by img(trail.query) as trail={...}. Inspect only
    // parents that import this module and pass that prop, not every query in
    // the application. Context-backed cards are covered by dependencies above.
    const props = dynamic
      .map(
        (call) =>
          /^([A-Za-z_$][\w$]*)(?:\??\.|$)/.exec(
            subjectParts(call.subject).read,
          )?.[1],
      )
      .filter(Boolean);
    for (const [parentFile, parent] of modules) {
      const componentNames = parent.components.get(file) ?? [];
      const passesSubject = componentNames.some((component) =>
        props.some((prop) =>
          new RegExp(
            `<${component.replaceAll("$", "\\$")}\\b[^>]*\\s${prop.replaceAll("$", "\\$")}\\s*=\\s*\\{`,
          ).test(parent.source),
        ),
      );
      if (passesSubject)
        collectDependencies(parentFile, subjects, named, visited, fields);
    }

    stats.dataQueries += named.size;
    // A computed call with nothing anywhere to name it is the one case this
    // cannot rescue: it is recorded so a gradient has a reason.
    // A call on the saved rows' image_query waits for thatcode to read them
    // (at the end of a build or a change): never blind, as the builder wrote
    // it as told. Any other field is the builder's to name.
    if (named.size === 0) {
      const relative = path.relative(process.cwd(), file);
      if (fields.some((field) => snakeName(field) === "image_query"))
        stats.savedPending.push(relative);
      else stats.blindFiles.push(relative);
    }
    for (const query of named) {
      queries.add(query);
      if (!orientations.has(query)) orientations.set(query, orientation);
    }
  }
  stats.seedQueries = fromSeed.size;
  return stats;
}

async function main() {
  const blueprintPath = path.resolve("src/content/blueprint.json");
  const outputPath = path.resolve("src/content/resolved-images.json");

  const queries = new Set();
  const orientations = new Map();
  try {
    collectImageQueries(
      JSON.parse(await readFile(blueprintPath, "utf-8")),
      queries,
    );
  } catch {
    console.warn("resolve-images: blueprint.json not found or unreadable");
  }
  const sourceScan = await collectSourceImageQueries(queries, orientations);
  if (queries.size === 0) {
    console.warn("resolve-images: no image queries found, writing empty map");
    await writeFile(outputPath, "{}\n");
    await writeReport({
      resolved: 0,
      total: 0,
      ms: 0,
      misses: [],
      source: sourceScan,
    });
    return;
  }

  if (!unsplashKey && !pexelsKey) {
    console.warn(
      "resolve-images: no UNSPLASH_ACCESS_KEY or PEXELS_API_KEY set, writing empty map",
    );
    await writeFile(outputPath, "{}\n");
    await writeReport({
      resolved: 0,
      total: queries.size,
      ms: 0,
      misses: [...queries],
      noKeys: true,
      source: sourceScan,
    });
    return;
  }

  /**
   * Every file apply re-runs this, including small updates to an existing site.
   * A query already answered by an earlier run keeps its photograph: the answer
   * cannot go stale, and refetching it would spend quota and seconds to arrive
   * at the same URL. Entries whose query no longer appears in the blueprint are
   * dropped rather than carried forward.
   */
  const reused = {};
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf-8"));
    // In the map's own order, so a run that looks nothing up writes it back
    // exactly as it was.
    for (const query of Object.keys(previous ?? {})) {
      if (!queries.has(query)) continue;
      const entry = usableEntry(previous[query]);
      if (entry) reused[query] = entry;
    }
  } catch {
    // No usable previous map; resolve the whole set.
  }
  // What each kept photograph shows comes forward with it, so the report
  // still describes a photo that was found by an earlier run.
  const photos = {};
  try {
    const previous = JSON.parse(await readFile(reportPath, "utf-8"));
    for (const query of Object.keys(reused)) {
      const descriptions = previous?.photos?.[query];
      if (Array.isArray(descriptions)) photos[query] = descriptions;
    }
  } catch {
    // No earlier report; kept photos are listed without descriptions.
  }

  const pending = [...queries].filter((query) => !(query in reused));

  if (pending.length === 0) {
    console.log(
      `resolve-images: reused all ${queries.size} queries, no lookups needed`,
    );
    await writeFile(outputPath, `${JSON.stringify(reused, null, 2)}\n`);
    await writeReport({
      resolved: queries.size,
      total: queries.size,
      ms: 0,
      misses: [],
      source: sourceScan,
      photos,
      reused: queries.size,
      lookups: [],
    });
    return;
  }

  console.log(
    `resolve-images: resolving ${pending.length} of ${queries.size} queries, reused ${Object.keys(reused).length} (unsplash=${!!unsplashKey}, pexels=${!!pexelsKey})`,
  );

  const resolved = { ...reused };
  const found = {};
  const tries = new Map(pending.map((query) => [query, []]));
  const budget = new AbortController();
  const budgetTimer = setTimeout(() => budget.abort(), TOTAL_BUDGET_MS);
  const startedAt = Date.now();

  try {
    await mapWithConcurrency(pending, CONCURRENCY, async (query) => {
      if (budget.signal.aborted) return;
      try {
        const shortlist = await resolveQuery(
          query,
          budget.signal,
          orientations.get(query) ?? "landscape",
          tries.get(query),
        );
        if (shortlist) found[query] = shortlist;
      } catch {
        // One unresolved query is one placeholder, not a failed build.
      }
    });
  } finally {
    clearTimeout(budgetTimer);
  }

  // Searching is done; each new photo's address is asked once whether it
  // loads (checkShortlists). The entries kept from earlier runs are not.
  const check = await checkShortlists(found, {
    budgetMs: Math.max(
      0,
      Math.min(CHECK_BUDGET_MS, CHECK_DEADLINE_MS - performance.now()),
    ),
  });

  const taken = new Set(Object.values(reused).map((urls) => urls[0]));
  for (const [query, shortlist] of Object.entries(
    spreadFirstPhotos(check.kept, taken),
  )) {
    resolved[query] = shortlist.map((photo) => photo.url);
    photos[query] = shortlist.map((photo) => photo.description);
  }

  const succeeded = Object.keys(resolved).length;
  console.log(
    `resolve-images: resolved ${succeeded}/${queries.size} queries in ${Date.now() - startedAt}ms${
      budget.signal.aborted ? " (budget reached)" : ""
    }`,
  );
  // Always written, even when empty or partial: the runtime reads this file
  // unconditionally, and a stale map from a previous run would be worse than
  // an honest placeholder.
  await writeFile(outputPath, `${JSON.stringify(resolved, null, 2)}\n`);

  await writeReport({
    resolved: succeeded,
    total: queries.size,
    ms: Date.now() - startedAt,
    budgetReached: budget.signal.aborted,
    misses: [...queries].filter((query) => !(query in resolved)),
    source: sourceScan,
    photos,
    reused: Object.keys(reused).length,
    check: check.summary,
    lookups: pending.map((query) => ({
      query,
      orientation: orientations.get(query) ?? "landscape",
      found: resolved[query]?.length ?? 0,
      ...(check.dropped[query] ? { dropped: check.dropped[query] } : {}),
      ...(check.unchecked[query] ? { unchecked: check.unchecked[query] } : {}),
      ...(photos[query]?.[0] ? { photo: photos[query][0] } : {}),
      tries: tries.get(query) ?? [],
    })),
  });
}

/**
 * The same line as a file beside the map, because the container's console
 * is not readable from outside and a gradient on a live site should be
 * explicable from the site itself. A separate file rather than a key in the
 * map: the map is imported as a typed JSON module, and one value of a
 * different shape would fail the site's typecheck. Written on every path,
 * the early returns included, so the executor that reads it back never
 * reads a previous run's. `photos` holds, per query, what each photograph in
 * the map shows, in the map's order: an agent asked to change a picture reads
 * it there, because the stock libraries' own pages refuse automated readers.
 * `lookups` holds every subject this run searched for, with each search it
 * made and what came of it; the subjects an earlier run answered are only
 * counted, in `reused`. `check` is the address check of this run's new
 * photos (checkShortlists): how many were asked, loaded, were dropped as
 * gone, and were kept unchecked and why; a lookup's `found` counts what was
 * kept after it, and its `dropped` and `unchecked` say the same per subject.
 */
const reportPath = path.resolve("src/content/resolved-images.report.json");

async function writeReport(report) {
  await writeFile(
    reportPath,
    `${JSON.stringify(
      { budgetReached: false, ...report, misses: report.misses.slice(0, 40) },
      null,
      2,
    )}\n`,
  );
}

// Run only as a script; the helpers above are importable for tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main()
    .catch(async (error) => {
      console.error("resolve-images: fatal error", error);
      // Write empty map so the build doesn't break.
      await writeFile(
        path.resolve("src/content/resolved-images.json"),
        "{}\n",
      ).catch(() => {});
    })
    // Everything is written, and the sandbox waits for the process, not the
    // report: end here rather than on whatever is still open.
    .finally(() => process.exit(0));
