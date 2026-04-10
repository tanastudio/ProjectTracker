// supabaseClient.js
//
// ANON KEY — safe to expose in browser code. It only allows the operations
// permitted by Row-Level Security policies. Keep it here.
//
// SERVICE ROLE KEY — must NEVER appear in frontend source. It bypasses all RLS.
// Use it only in server-side scripts (create-candidate-users.mjs) and edge
// functions, loaded exclusively from environment variables.
//
// Environment switching is handled in js/config.js (auto-detects by hostname).

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./js/config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
