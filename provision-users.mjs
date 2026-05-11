import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "http://127.0.0.1:55321";
const DEFAULT_PASSWORD =
  process.env.TEST_USER_PASSWORD ||
  process.env.DEFAULT_PARTICIPANT_PASSWORD;
const MAIL_NAMESPACE = "localtest";

const CLIENT_USERS = [
  { label: "Client A", displayName: "Client A", email: namespaceEmail("client001"), role: "client", memberRole: "viewer" },
  { label: "Client B", displayName: "Client B", email: namespaceEmail("client002"), role: "client", memberRole: "viewer" },
  { label: "Client C", displayName: "Client C", email: namespaceEmail("client003"), role: "client", memberRole: "viewer" },
];

const INTERNAL_USERS = [
  { label: "Internal A", displayName: "Internal A", email: namespaceEmail("internal001"), role: "internal", memberRole: "editor" },
  { label: "Internal B", displayName: "Internal B", email: namespaceEmail("internal002"), role: "internal", memberRole: "editor" },
];

const ADMIN_USERS = [
  { label: "Admin Test", displayName: "Admin Test", email: namespaceEmail("admin001"), role: "admin", memberRole: "editor" },
];

function namespaceEmail(tag) {
  return `${MAIL_NAMESPACE}.${tag}@inbox.testmail.app`;
}

function namespacedParticipantEmail(index) {
  return namespaceEmail(`cand${String(index + 1).padStart(3, "0")}`);
}

function shouldUseNamespacedParticipantEmails() {
  const supabaseUrl = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).toLowerCase();
  return supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");
}

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseSecret) {
    throw new Error("Missing SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function requirePassword() {
  if (!DEFAULT_PASSWORD) {
    throw new Error("Missing TEST_USER_PASSWORD or DEFAULT_PARTICIPANT_PASSWORD");
  }
}

async function listAllUsers(supabase) {
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

  return users;
}

async function ensureAuthUser(supabase, { email, displayName, role, password = DEFAULT_PASSWORD }) {
  const users = await listAllUsers(supabase);
  const existing = users.find((user) => String(user.email || "").toLowerCase() === email.toLowerCase());

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, role },
    });
    if (error) throw new Error(`updateUserById failed for ${email}: ${error.message}`);
    return { user: data.user, created: false };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, role },
  });
  if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
  return { user: data.user, created: true };
}

async function ensureProfile(supabase, { id, displayName, email, role, participantRecordId = null }) {
  const payload = {
    id,
    display_name: displayName,
    email,
    role,
  };

  if (participantRecordId) {
    payload.participant_record_id = participantRecordId;
  }

  const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) throw new Error(`profiles upsert failed for ${id}: ${error.message}`);
}

async function ensureMemberships(supabase, userId, projectIds, role) {
  if (!projectIds.length) return;

  const rows = projectIds.map((projectId) => ({
    user_id: userId,
    project_id: projectId,
    role,
  }));

  const { error } = await supabase
    .from("project_members")
    .upsert(rows, { onConflict: "user_id,project_id" });

  if (error) throw new Error(`project_members upsert failed for ${userId}: ${error.message}`);
}

async function getProjects(supabase) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .order("name");

  if (error) throw new Error(`Failed to load projects: ${error.message}`);
  return data || [];
}

async function getParticipantRecords(supabase, { projectId } = {}) {
  let query = supabase
    .from("records")
    .select(`
      id,
      code,
      title,
      project_id,
      record_values!inner (
        field_id,
        value_text,
        fields!inner (field_role)
      )
    `)
    .eq("active", true)
    .eq("record_values.fields.field_role", "email")
    .order("code");

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch participant records: ${error.message}`);

  return (data || [])
    .map((record) => ({
      recordId: record.id,
      code: record.code,
      displayName: record.title || record.code || "Participant",
      emailFieldId: record.record_values?.[0]?.field_id || null,
      email: record.record_values?.[0]?.value_text || null,
      projectId: record.project_id,
    }))
    .filter((record) => record.email);
}

function toSummaryUser(user, password) {
  return {
    label: user.label,
    role: user.role,
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    password,
  };
}

async function runParticipantsMode() {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing PROJECT_ID for participants mode");
  }

  requirePassword();

  const supabase = createAdminClient();
  const participants = await getParticipantRecords(supabase, { projectId });

  console.log(`Found ${participants.length} participant record(s) in project ${projectId}\n`);

  for (const [index, participant] of participants.entries()) {
    const targetEmail = shouldUseNamespacedParticipantEmails()
      ? namespacedParticipantEmail(index)
      : participant.email;

    console.log(`Processing ${participant.code || "(no code)"} - ${participant.displayName} <${targetEmail}>`);

    try {
      if (targetEmail !== participant.email && participant.emailFieldId) {
        const { error: emailUpdateError } = await supabase
          .from("record_values")
          .update({ value_text: targetEmail })
          .eq("record_id", participant.recordId)
          .eq("field_id", participant.emailFieldId);
        if (emailUpdateError) throw new Error(`record_values email update failed for ${participant.recordId}: ${emailUpdateError.message}`);
      }

      const { user, created } = await ensureAuthUser(supabase, {
        email: targetEmail,
        displayName: participant.displayName,
        role: "participant",
      });

      await ensureProfile(supabase, {
        id: user.id,
        displayName: participant.displayName,
        email: targetEmail,
        role: "participant",
        participantRecordId: participant.recordId,
      });

      await ensureMemberships(supabase, user.id, [participant.projectId], "viewer");
      console.log(`  [OK] ${created ? "created" : "updated"} auth user, profile, and membership`);
    } catch (error) {
      console.error(`  [ERROR] ${error.message}`);
    }

    console.log();
  }

  console.log("Done.");
}

async function provisionStaffLikeUsers(supabase, users, projectIds, password) {
  const created = [];

  for (const user of users) {
    const { user: authUser } = await ensureAuthUser(supabase, {
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      password,
    });

    await ensureProfile(supabase, {
      id: authUser.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    });

    await ensureMemberships(supabase, authUser.id, projectIds, user.memberRole);

    created.push(
      toSummaryUser(
        {
          label: user.label,
          role: user.role,
          userId: authUser.id,
          email: user.email,
          displayName: user.displayName,
        },
        password,
      ),
    );
  }

  return created;
}

async function provisionParticipants(supabase, password) {
  const participants = await getParticipantRecords(supabase);
  const testUsers = [];

  for (const [index, participant] of participants.entries()) {
    const targetEmail = shouldUseNamespacedParticipantEmails()
      ? namespacedParticipantEmail(index)
      : participant.email;

    if (targetEmail !== participant.email && participant.emailFieldId) {
      const { error: emailUpdateError } = await supabase
        .from("record_values")
        .update({ value_text: targetEmail })
        .eq("record_id", participant.recordId)
        .eq("field_id", participant.emailFieldId);
      if (emailUpdateError) {
        throw new Error(`record_values email update failed for ${participant.recordId}: ${emailUpdateError.message}`);
      }
    }

    const { user: authUser } = await ensureAuthUser(supabase, {
      email: targetEmail,
      displayName: participant.displayName,
      role: "participant",
      password,
    });

    await ensureProfile(supabase, {
      id: authUser.id,
      displayName: participant.displayName,
      email: targetEmail,
      role: "participant",
      participantRecordId: participant.recordId,
    });

    await ensureMemberships(supabase, authUser.id, [participant.projectId], "viewer");

    testUsers.push(
      toSummaryUser(
        {
          label: participant.code || participant.displayName,
          role: "participant",
          userId: authUser.id,
          email: targetEmail,
          displayName: participant.displayName,
        },
        password,
      ),
    );
  }

  return testUsers;
}

async function runTestUsersMode() {
  requirePassword();

  const supabase = createAdminClient();
  const projects = await getProjects(supabase);
  const projectIds = projects.map((project) => project.id);

  if (!projectIds.length) {
    throw new Error("No projects found. Create a project first, then rerun this script.");
  }

  const adminUsers = await provisionStaffLikeUsers(supabase, ADMIN_USERS, projectIds, DEFAULT_PASSWORD);
  const clientUsers = await provisionStaffLikeUsers(supabase, CLIENT_USERS, projectIds, DEFAULT_PASSWORD);
  const internalUsers = await provisionStaffLikeUsers(supabase, INTERNAL_USERS, projectIds, DEFAULT_PASSWORD);
  const participantUsers = await provisionParticipants(supabase, DEFAULT_PASSWORD);

  const summary = {
    mode: "test-users",
    password: DEFAULT_PASSWORD,
    projectCount: projectIds.length,
    created: {
      admins: adminUsers,
      clients: clientUsers,
      internals: internalUsers,
      participants: participantUsers,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

export async function runProvisionUsers(mode) {
  if (mode === "participants") {
    await runParticipantsMode();
    return;
  }

  if (mode === "test-users") {
    await runTestUsersMode();
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;

  const entryUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`);
  return import.meta.url === entryUrl.href;
}

if (isDirectExecution()) {
  const mode = process.argv[2];

  if (!mode || mode === "--help" || mode === "-h") {
    console.log("Usage:");
    console.log("  node --env-file=.env provision-users.mjs participants");
    console.log("  node --env-file=.env provision-users.mjs test-users");
    process.exit(mode ? 0 : 1);
  }

  runProvisionUsers(mode).catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
