import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:55321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getParticipantProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("role", "participant")
    .order("display_name");

  if (error) throw new Error(`Failed to load participant profiles: ${error.message}`);
  return data || [];
}

async function getParticipantRecords() {
  const { data, error } = await supabase
    .from("records")
    .select(`
      id,
      code,
      project_id,
      record_values!inner (
        value_text,
        fields!inner (
          label,
          field_role
        )
      )
    `)
    .eq("active", true)
    .order("code");

  if (error) throw new Error(`Failed to load participant records: ${error.message}`);

  return (data || [])
    .map((record) => {
      const emailValue = (record.record_values || []).find((entry) => {
        const field = entry.fields;
        const label = String(field?.label || "").toLowerCase();
        return field?.field_role === "email" || label.includes("email");
      });

      return {
        recordId: record.id,
        code: record.code,
        projectId: record.project_id,
        email: String(emailValue?.value_text || "").trim().toLowerCase(),
      };
    })
    .filter((record) => record.email);
}

async function getAuthUsersByEmail() {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);

    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }

  return new Map(
    users
      .filter((user) => user.email)
      .map((user) => [String(user.email).trim().toLowerCase(), user]),
  );
}

async function main() {
  const [profiles, records, authUsersByEmail] = await Promise.all([
    getParticipantProfiles(),
    getParticipantRecords(),
    getAuthUsersByEmail(),
  ]);

  const updates = [];

  for (const record of records) {
    const authUser = authUsersByEmail.get(record.email);
    if (!authUser) continue;

    const profile = profiles.find((item) => item.id === authUser.id);
    if (!profile) continue;

    updates.push({
      id: profile.id,
      display_name: profile.display_name,
      role: "participant",
      participant_record_id: record.recordId,
    });
  }

  if (!updates.length) {
    console.log("No participant profiles matched participant records.");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(updates, { onConflict: "id" });

  if (error) throw new Error(`profiles upsert failed: ${error.message}`);

  console.log(`Relinked ${updates.length} participant profile(s).`);
}

await main();
