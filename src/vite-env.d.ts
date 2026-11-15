/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The connected Supabase project's URL; absent without one. */
  readonly VITE_SUPABASE_URL?: string;
  /** Its publishable key, public by design. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The same key under the older name. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** thatcode's AI route for this app (src/integrations/thatcode/ai.ts); absent until set up. */
  readonly VITE_THATCODE_AI_URL?: string;
  /** This app's public key for it, accepted only from the app's own address. */
  readonly VITE_THATCODE_AI_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
