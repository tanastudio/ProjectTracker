// js/config.js
//
// Single source of truth for environment-specific Supabase endpoints.
// By default, both localhost and production use the remote Supabase project.
// To test against a local Supabase stack from localhost, open any page with ?supabase=local.
// To switch back, open any page with ?supabase=remote.

const ENV_STORAGE_KEY = "project_tracker_supabase_env";
const locationRef = globalThis.location || { search: "", hostname: "" };
const envParam = new URLSearchParams(locationRef.search || "").get("supabase");
const host = String(locationRef.hostname || "").toLowerCase();
const canUseLocalSupabase = host === "localhost" || host === "127.0.0.1" || host === "::1";

try {
  localStorage.removeItem(ENV_STORAGE_KEY);
  if (envParam === "remote") {
    sessionStorage.removeItem(ENV_STORAGE_KEY);
  } else if (envParam === "local" && canUseLocalSupabase) {
    sessionStorage.setItem(ENV_STORAGE_KEY, "local");
  } else if (envParam === "local" && !canUseLocalSupabase) {
    sessionStorage.removeItem(ENV_STORAGE_KEY);
  }
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}

let storedEnv = "remote";
try {
  storedEnv = sessionStorage.getItem(ENV_STORAGE_KEY) === "local" ? "local" : "remote";
} catch {
  storedEnv = "remote";
}

const SUPABASE_ENV = canUseLocalSupabase && storedEnv === "local" ? "local" : "remote";
const IS_LOCAL = SUPABASE_ENV === "local";

const LOCAL_URL = "http://127.0.0.1:55321";
const LOCAL_ANON_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const REMOTE_URL = "https://vusgsdcozkaumyudqhlu.supabase.co";
const REMOTE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1c2dzZGNvemthdW15dWRxaGx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzQxNzMsImV4cCI6MjA4NzY1MDE3M30.HaNfD05Cpo9f5QrU_JTzoyYAik-7c7EKXI03knUSrnI";

export const SUPABASE_URL = IS_LOCAL ? LOCAL_URL : REMOTE_URL;
export const SUPABASE_ANON_KEY = IS_LOCAL ? LOCAL_ANON_KEY : REMOTE_ANON_KEY;
export const SUPABASE_ENVIRONMENT = SUPABASE_ENV;

try {
  document.documentElement.setAttribute("data-supabase-env", SUPABASE_ENV);
} catch {
  // Non-browser consumers can import the constants without a DOM.
}
