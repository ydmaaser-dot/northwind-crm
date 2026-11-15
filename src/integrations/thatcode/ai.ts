/**
 * thatcode's AI for this app: write text, get data and make images with no
 * API key.
 *
 * thatcode supplies the address and this app's key when it builds the app;
 * each use is paid from the owner's thatcode credits. Errors carry a plain
 * message meant for the page (for example when the site's AI is paused
 * because its daily limit was reached), so show `error.message` as it is.
 */

const endpoint = import.meta.env.VITE_THATCODE_AI_URL;
const key = import.meta.env.VITE_THATCODE_AI_KEY;

/** False until thatcode has set this app up for AI (it does when it builds it). */
export const aiAvailable = Boolean(endpoint && key);

export class AiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiTextInput =
  | string
  | { prompt: string; system?: string }
  | { messages: AiMessage[]; system?: string };

function visitorId() {
  try {
    const saved = window.localStorage.getItem("thatcode-ai-visitor");
    if (saved) return saved;
    const made = crypto.randomUUID();
    window.localStorage.setItem("thatcode-ai-visitor", made);
    return made;
  } catch {
    return "anonymous";
  }
}

async function request(
  path: "image" | "text",
  body: unknown,
  signal?: AbortSignal,
) {
  if (!endpoint || !key)
    throw new AiError("AI isn't set up for this site yet.", "unknown_site");
  let response: Response;
  try {
    response = await fetch(`${endpoint}/${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-thatcode-site-key": key,
        "x-thatcode-visitor": visitorId(),
      },
      method: "POST",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AiError(
      "The AI could not be reached. Please try again.",
      "unavailable",
    );
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new AiError(
      failure?.error?.message ??
        "The AI could not answer just now. Please try again.",
      failure?.error?.code ?? "unavailable",
    );
  }
  return response;
}

function textBody(input: AiTextInput, stream: boolean) {
  return typeof input === "string"
    ? { prompt: input, stream }
    : { ...input, stream };
}

/**
 * The whole answer at once. One answer holds about 3,000 words; one that
 * does not fit is never handed over cut short: this throws an AiError with
 * the code "too_long", so ask for less or in several smaller requests.
 */
export async function generateText(
  input: AiTextInput,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const response = await request(
    "text",
    textBody(input, false),
    options.signal,
  );
  const { text } = (await response.json()) as { text: string };
  return text;
}

const unreadable = "The AI's answer could not be read. Please try again.";
/**
 * An answer read as JSON: bare, or one Markdown code fence that is the whole
 * answer. thatcode reads answers the same way; this copy is for an older
 * thatcode that answered text.
 */
function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
  let body = text.trim();
  if (body.startsWith("```") && body.endsWith("```") && body.length >= 6) {
    const firstBreak = body.indexOf("\n");
    body = firstBreak === -1 ? "" : body.slice(firstBreak + 1, -3).trim();
  }
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

/**
 * Data from the AI (a plan, a quiz, a list of scenes): the answer as a
 * parsed JSON value, never text to parse yourself. thatcode asks the AI for
 * JSON, checks it, and asks once more when it does not read. When it still
 * does not, this throws an AiError with the code "bad_json" and a plain
 * message to show; an answer too long to finish throws "too_long", as
 * generateText does. Say in the prompt which fields you want.
 */
export async function generateJson<T = unknown>(
  input: AiTextInput,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const response = await request(
    "text",
    { ...textBody(input, false), format: "json" },
    options.signal,
  );
  const answer = (await response.json()) as { data?: T; text?: string };
  if ("data" in answer) return answer.data as T;
  // An older thatcode answered text: read it here, never in the page.
  const read = readJson(answer.text ?? "");
  if (!read.ok) throw new AiError(unreadable, "bad_json");
  return read.value as T;
}

/** The answer as it is written: show each part as it arrives. */
export async function* streamText(
  input: AiTextInput,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const response = await request("text", textBody(input, true), options.signal);
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = decoder.decode(value, { stream: true });
      if (part) yield part;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * One picture as a data: URL to put in an <img src>. It is large: keep it in
 * state while it is shown. To keep it, upload it to file storage and save its
 * link, never the data: URL itself in a table or in browser storage.
 */
export async function generateImage(
  prompt: string,
  options: {
    shape?: "landscape" | "portrait" | "square";
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const response = await request(
    "image",
    { prompt, ...(options.shape ? { shape: options.shape } : {}) },
    options.signal,
  );
  const { image } = (await response.json()) as { image: string };
  return image;
}
