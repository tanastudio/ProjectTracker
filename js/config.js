// js/config.js
//
// Single source of truth for environment-specific Supabase endpoints.
// Auto-detected at runtime by hostname — no build step needed.
//
// Local dev  → serve from http://127.0.0.1:3000 (or localhost:*)
// Production → serve from your real domain
//
// PRODUCTION ANON KEY:
//   Supabase Dashboard → Project → Settings → API → "anon public" key.
//   Safe to commit — RLS enforces all access control.

const IS_LOCAL =
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "";

// ── Local (supabase start) ────────────────────────────────────────────────────
const LOCAL_URL      = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

// ── Remote (Supabase cloud) ───────────────────────────────────────────────────
// Get the anon key from: Supabase Dashboard → Project → Settings → API → anon public
const REMOTE_URL      = "https://vusgsdcozkaumyudqhlu.supabase.co";
const REMOTE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1c2dzZGNvemthdW15dWRxaGx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzQxNzMsImV4cCI6MjA4NzY1MDE3M30.HaNfD05Cpo9f5QrU_JTzoyYAik-7c7EKXI03knUSrnI"; // ← fill in from dashboard

export const SUPABASE_URL       = IS_LOCAL ? LOCAL_URL      : REMOTE_URL;
export const SUPABASE_ANON_KEY  = IS_LOCAL ? LOCAL_ANON_KEY : REMOTE_ANON_KEY;
