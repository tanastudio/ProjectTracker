// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validateInput(body: Record<string, unknown>) {
  const projectId = String(body.project_id ?? "").trim();
  const userId = String(body.user_id ?? "").trim();
  const password = String(body.password ?? "");

  if (!projectId || !userId || !password) {
    return { ok: false as const, error: "project_id, user_id, and password are required" };
  }
  if (password.length < 8) {
    return { ok: false as const, error: "Password must be at least 8 characters" };
  }

  return { ok: true as const, projectId, userId, password };
}

async function writeAuditLog(
  adminClient: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
) {
  try {
    const { error } = await adminClient.from("audit_logs").insert(entry);
    if (error) console.warn(`admin-reset-password audit log failed: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`admin-reset-password audit log failed: ${message}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user: caller } } = await userClient.auth.getUser();
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role, email")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin") return json({ error: "Admin only" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const validated = validateInput(body);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { projectId, userId, password } = validated;

  const { data: membership, error: memberError } = await adminClient
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) return json({ error: memberError.message }, 500);
  if (!membership) return json({ error: "Target user is not a member of this project" }, 404);

  const { data: targetProfile } = await adminClient
    .from("profiles")
    .select("email, display_name, role")
    .eq("id", userId)
    .maybeSingle();

  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    password,
  });
  if (updateError) return json({ error: updateError.message }, 500);

  const { error: forceResetError } = await adminClient
    .from("profiles")
    .update({ force_password_reset: true })
    .eq("id", userId);
  if (forceResetError) return json({ error: `Password updated, but force reset flag failed: ${forceResetError.message}` }, 500);

  await writeAuditLog(adminClient, {
    actor_user_id: caller.id,
    actor_email: callerProfile?.email || caller.email || null,
    actor_role: callerProfile?.role || null,
    action: "UPDATE",
    table_name: "auth.users",
    entity_id: userId,
    project_id: projectId,
    summary: "Admin reset a project member password",
    metadata: {
      event: "admin_reset_password",
      project_id: projectId,
      target_email: targetProfile?.email || null,
      target_display_name: targetProfile?.display_name || null,
      target_role: targetProfile?.role || null,
      force_password_reset: true,
    },
  });

  return json({
    ok: true,
    user_id: userId,
    email: targetProfile?.email || null,
  });
});
