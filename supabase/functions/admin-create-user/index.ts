// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Input validation (pure, exported for tests).
export function validateInput(body: Record<string, unknown>): {
  ok: true; email: string; displayName: string; projectId: string; code: string;
} | { ok: false; error: string } {
  const email       = String(body.email        ?? "").trim().toLowerCase();
  const displayName = String(body.display_name ?? "").trim();
  const projectId   = String(body.project_id   ?? "").trim();
  const code        = String(body.code         ?? "").trim();

  if (!email || !displayName || !projectId) {
    return { ok: false, error: "email, display_name, and project_id are required" };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: `Invalid email format: ${email}` };
  }
  if (code.length > 80) {
    return { ok: false, error: "code must be 80 characters or fewer" };
  }
  return { ok: true, email, displayName, projectId, code };
}

// Paginated auth-user lookup by email.
// Supabase admin.listUsers does not support filter-by-email, so we paginate
// through all pages until we find the user or exhaust all pages.
export async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const perPage = 1000;
  let page      = 1;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users) return null;

    const found = data.users.find((u: any) => u.email === email);
    if (found) return found.id;

    // If the page returned fewer users than requested, we've reached the last page
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function writeAuditLog(
  adminClient: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
) {
  try {
    const { error } = await adminClient.from("audit_logs").insert(entry);
    if (error) console.warn(`admin-create-user audit log failed: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`admin-create-user audit log failed: ${message}`);
  }
}

async function canProvisionParticipant(
  adminClient: ReturnType<typeof createClient>,
  callerId: string,
  callerRole: string | null | undefined,
  projectId: string,
): Promise<boolean> {
  const role = String(callerRole || "").trim().toLowerCase();
  if (role === "admin") return true;
  if (role !== "internal") return false;

  const [{ data: project }, { data: membership }] = await Promise.all([
    adminClient.from("projects").select("created_by").eq("id", projectId).maybeSingle(),
    adminClient
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", callerId)
      .maybeSingle(),
  ]);

  const memberRole = String(membership?.role || "").trim().toLowerCase();
  return project?.created_by === callerId || memberRole === "admin" || memberRole === "editor";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey         = Deno.env.get("SUPABASE_ANON_KEY")!;
  const defaultPassword = Deno.env.get("DEFAULT_PARTICIPANT_PASSWORD")?.trim() || "";
  if (!defaultPassword) {
    return json({ error: "DEFAULT_PARTICIPANT_PASSWORD is not configured" }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Auth: verify caller can manage participant provisioning for the project.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user: caller } } = await userClient.auth.getUser();
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const { data: callerProfile } = await adminClient
    .from("profiles").select("role").eq("id", caller.id).maybeSingle();

  // Parse and validate input.
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const validated = validateInput(body);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const { email, displayName, projectId, code } = validated;
  if (!(await canProvisionParticipant(adminClient, caller.id, callerProfile?.role, projectId))) {
    return json({ error: "Admin or internal project editor only" }, 403);
  }

  // Validate project exists.
  const { data: proj } = await adminClient
    .from("projects").select("id, code_prefix").eq("id", projectId).maybeSingle();
  if (!proj) {
    console.error(`admin-create-user: project not found: ${projectId}`);
    return json({ error: `Project not found: ${projectId}` }, 404);
  }

  // Validate email field exists for storing participant email.
  const { data: emailField } = await adminClient
    .from("fields").select("id")
    .eq("project_id", projectId).eq("field_role", "email").maybeSingle();
  if (!emailField?.id) {
    console.warn(`admin-create-user: no email field for project ${projectId} - email will not be stored in record_values`);
    // Non-fatal: proceed without saving email to record_values
  }

  console.log(`admin-create-user: processing ${email} for project ${projectId}`);

  // Step 1: find or create auth user.
  // Try to create first (fast path). On conflict, paginate through users to find them.
  let userId: string;
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: defaultPassword,
    email_confirm: true,
    user_metadata: { display_name: displayName, role: "participant" },
  });

  if (!createErr) {
    userId = created.user.id;
    console.log(`admin-create-user [step 1]: created auth user ${userId}`);
  } else if (/already registered|already exists|duplicate/i.test(createErr.message)) {
    const existingId = await findAuthUserByEmail(adminClient, email);
    if (!existingId) {
      return json({ error: `User ${email} already exists but could not be located` }, 500);
    }
    userId = existingId;
    console.log(`admin-create-user [step 1]: reusing existing user ${userId}`);
  } else {
    console.error(`admin-create-user [step 1]: createUser failed for ${email}: ${createErr.message}`);
    return json({ error: `createUser failed: ${createErr.message}` }, 500);
  }

  // Steps 2-5: idempotent profile/record/member setup.
  // Track userId so partial failures include it in logs for easy repair.
  try {
    // Step 2: upsert profile
    const { data: existingProfile, error: profReadErr } = await adminClient
      .from("profiles").select("participant_record_id").eq("id", userId).maybeSingle();
    if (profReadErr) throw new Error(`[step 2] profiles read failed: ${profReadErr.message}`);

    const { error: profErr } = await adminClient.from("profiles").upsert(
      { id: userId, display_name: displayName, email, role: "participant", force_password_reset: true },
      { onConflict: "id" },
    );
    if (profErr) throw new Error(`[step 2] profiles upsert failed: ${profErr.message}`);
    console.log(`admin-create-user [step 2]: profile ok`);

    // Step 3: find or create record for this project
    let recordId: string | null = existingProfile?.participant_record_id ?? null;

    // Verify the linked record actually belongs to the requested project
    if (recordId) {
      const { data: existingRec } = await adminClient
        .from("records").select("id").eq("id", recordId).eq("project_id", projectId).maybeSingle();
      if (!existingRec) recordId = null; // linked to a different project
    }

    if (!recordId) {
      // Generate collision-free code via DB function (uses FOR UPDATE row lock)
      let generatedCode = code;
      if (!generatedCode) {
        const { data, error: codeErr } = await adminClient
          .rpc("generate_participant_code", { p_project_id: projectId });
        if (codeErr) throw new Error(`[step 3] code generation failed: ${codeErr.message}`);
        generatedCode = String(data || "").trim();
      }

      const { data: rec, error: recErr } = await adminClient.from("records").insert({
        project_id: projectId,
        title:      displayName,
        active:     true,
        updated_by: caller.id,
        ...(generatedCode ? { code: generatedCode } : {}),
      }).select("id").single();
      if (recErr) {
        if (generatedCode && /duplicate|unique/i.test(recErr.message)) {
          const { data: existingRec, error: existingRecErr } = await adminClient
            .from("records")
            .select("id")
            .eq("project_id", projectId)
            .eq("code", generatedCode)
            .maybeSingle();
          if (existingRecErr) throw new Error(`[step 3] records lookup after duplicate failed: ${existingRecErr.message}`);
          if (!existingRec?.id) throw new Error(`[step 3] records insert failed: ${recErr.message}`);
          recordId = existingRec.id;
        } else {
          throw new Error(`[step 3] records insert failed: ${recErr.message}`);
        }
      } else {
        recordId = rec.id;
      }

      // Link profile to record.
      const { error: linkErr } = await adminClient
        .from("profiles").update({ participant_record_id: recordId }).eq("id", userId);
      if (linkErr) throw new Error(`[step 3] profiles update (participant_record_id) failed: ${linkErr.message}`);
    }
    console.log(`admin-create-user [step 3]: record ${recordId}`);

    // Step 4: save email in record_values
    if (emailField?.id && recordId) {
      const { error: rvErr } = await adminClient.from("record_values").upsert({
        record_id:  recordId,
        field_id:   emailField.id,
        value_text: email,
      }, { onConflict: "record_id,field_id" });
      if (rvErr) throw new Error(`[step 4] record_values upsert failed: ${rvErr.message}`);
      console.log(`admin-create-user [step 4]: email stored in record_values`);
    }

    // Step 5: add to project_members
    const { error: pmErr } = await adminClient.from("project_members").upsert({
      user_id:    userId,
      project_id: projectId,
      role:       "viewer",
    }, { onConflict: "user_id,project_id" });
    if (pmErr) throw new Error(`[step 5] project_members upsert failed: ${pmErr.message}`);
    console.log(`admin-create-user [step 5]: project member ok`);

    await writeAuditLog(adminClient, {
      actor_user_id: caller.id,
      actor_email: caller.email ?? null,
      actor_role: callerProfile?.role || null,
      action: "INSERT",
      table_name: "auth.users",
      entity_id: userId,
      project_id: projectId,
      summary: `Provisioned participant user ${email}`,
      metadata: {
        source: "admin-create-user",
        participant_email: email,
        display_name: displayName,
        record_id: recordId,
      },
    });

    return json({ ok: true, user: { id: userId, email }, record_id: recordId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    // Include userId so a partial failure can be found and repaired manually
    console.error(`admin-create-user partial failure (auth user: ${userId}, project: ${projectId}, email: ${email}): ${msg}`);
    return json({ error: msg, partial_failure: true, user_id: userId }, 500);
  }
});
