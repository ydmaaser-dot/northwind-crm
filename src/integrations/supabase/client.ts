import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The app's Supabase client, or null while the project has no Supabase
 * project connected. thatcode supplies the URL and publishable key when it
 * builds the app; never put a key in source. The publishable key is public,
 * so every table it can reach must be protected by row level security.
 */
export const supabase =
  url && publishableKey ? createClient<Database>(url, publishableKey) : null;

/** The client, for code that cannot work without a connected Supabase project. */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not connected. Connect a Supabase project to this app first.",
    );
  }
  return supabase;
}
