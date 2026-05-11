// js/config.js
//
// Single source of truth for environment-specific Supabase endpoints.
// By default, both localhost and production use the remote Supabase project.
// To test against a local Supabase stack, open any page with ?supabase=local.
// To switch back, open any page with ?supabase=remote.

const envParam = new URLSearchParams(window.location.search).get("supabase");
if (envParam === "local" || envParam === "remote") {
  localStorage.setItem("project_tracker_supabase_env", envParam);
}

const SUPABASE_ENV = localStorage.getItem("project_tracker_supabase_env") === "local" ? "local" : "remote";
const IS_LOCAL = SUPABASE_ENV === "local";

const LOCAL_URL = "http://127.0.0.1:55321";
const LOCAL_ANON_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const REMOTE_URL = "https://vusgsdcozkaumyudqhlu.supabase.co";
const REMOTE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1c2dzZGNvemthdW15dWRxaGx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzQxNzMsImV4cCI6MjA4NzY1MDE3M30.HaNfD05Cpo9f5QrU_JTzoyYAik-7c7EKXI03knUSrnI";

export const SUPABASE_URL = IS_LOCAL ? LOCAL_URL : REMOTE_URL;
export const SUPABASE_ANON_KEY = IS_LOCAL ? LOCAL_ANON_KEY : REMOTE_ANON_KEY;
export const SUPABASE_ENVIRONMENT = SUPABASE_ENV;
