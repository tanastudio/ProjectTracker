// Run: node --env-file=.env create-candidate-users.mjs
// Requires: npm install @supabase/supabase-js
// Copy .env.example → .env and fill in the values before running

import { createClient } from "@supabase/supabase-js";

// ── Config (from .env) ────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_ID        = process.env.PROJECT_ID;
// DEFAULT_CANDIDATE_PASSWORD is optional — falls back to the built-in value.
const DEFAULT_PASSWORD  = process.env.DEFAULT_CANDIDATE_PASSWORD ?? "Mentis2026!";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PROJECT_ID) {
    console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROJECT_ID");
    console.error("Copy .env.example → .env and fill in the required values.");
    process.exit(1);
}
if (!process.env.DEFAULT_CANDIDATE_PASSWORD) {
    console.warn("DEFAULT_CANDIDATE_PASSWORD not set — using built-in fallback password.");
}
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function getCandidates() {
    // ดึง records + email จาก record_values
    const { data, error } = await supabase
        .from("records")
        .select(`
            id,
            code,
            title,
            project_id,
            record_values!inner (
                value_text,
                fields!inner ( field_role )
            )
        `)
        .eq("project_id", PROJECT_ID)
        .eq("record_values.fields.field_role", "email")
        .eq("active", true);

    if (error) throw new Error("Failed to fetch candidates: " + error.message);

    return (data || []).map((r) => ({
        record_id: r.id,
        code: r.code,
        name: r.title,
        email: r.record_values?.[0]?.value_text || null,
        project_id: r.project_id,
    })).filter((r) => r.email);
}

async function createOrGetUser(email, name) {
    // ลอง list user ที่มีอยู่แล้ว
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = (list?.users || []).find((u) => u.email === email);
    if (existing) {
        console.log(`  [SKIP] Already exists: ${email} (${existing.id})`);
        return existing.id;
    }

    // สร้าง auth user ใหม่
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true, // ไม่ต้อง confirm email
        user_metadata: { display_name: name, role: "candidate" },
    });

    if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
    console.log(`  [CREATED] ${email} → ${data.user.id}`);
    return data.user.id;
}

async function upsertProfile(userId, name) {
    const { error } = await supabase.from("profiles").upsert({
        id: userId,
        display_name: name,
        role: "candidate",
    }, { onConflict: "id" });

    if (error) throw new Error(`upsertProfile failed for ${userId}: ${error.message}`);
}

async function upsertProjectMember(userId, projectId) {
    const { error } = await supabase.from("project_members").upsert({
        user_id: userId,
        project_id: projectId,
        role: "viewer",
    }, { onConflict: "user_id,project_id" });

    if (error) throw new Error(`upsertProjectMember failed for ${userId}: ${error.message}`);
}

async function main() {
    console.log("Fetching candidates from Project ABC...");
    const candidates = await getCandidates();
    console.log(`Found ${candidates.length} candidates\n`);

    for (const c of candidates) {
        console.log(`Processing ${c.code} — ${c.name} <${c.email}>`);
        try {
            const userId = await createOrGetUser(c.email, c.name);
            await upsertProfile(userId, c.name);
            await upsertProjectMember(userId, c.project_id);
            console.log(`  [OK] profile + project_member done`);
        } catch (e) {
            console.error(`  [ERROR] ${e.message}`);
        }
        console.log();
    }

    console.log("Done.");
}

main().catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
});
