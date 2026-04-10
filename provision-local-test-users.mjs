import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SECRET =
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD =
  process.env.TEST_USER_PASSWORD ||
  process.env.DEFAULT_CANDIDATE_PASSWORD ||
  "Mentis2026!";
const MAIL_NAMESPACE = "r8mt4";
const namespaceEmail = (tag) => `${MAIL_NAMESPACE}.${tag}@inbox.testmail.app`;

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

if (!SUPABASE_SECRET) {
  console.error("Missing SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllUsers() {
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

async function ensureAuthUser({ email, displayName, role, password = DEFAULT_PASSWORD }) {
  const users = await listAllUsers();
  const existing = users.find((user) => String(user.email || "").toLowerCase() === email.toLowerCase());

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, role },
    });
    if (error) throw new Error(`updateUserById failed for ${email}: ${error.message}`);
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, role },
  });
  if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
  return data.user;
}

async function ensureProfile({ id, displayName, role, candidateRecordId = null }) {
  const payload = {
    id,
    display_name: displayName,
    role,
  };

  if (candidateRecordId) {
    payload.candidate_record_id = candidateRecordId;
  }

  const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) throw new Error(`profiles upsert failed for ${id}: ${error.message}`);
}

async function ensureMemberships(userId, projectIds, role) {
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

async function getProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .order("name");

  if (error) throw new Error(`Failed to load projects: ${error.message}`);
  return data || [];
}

async function getCandidateRecords() {
  const { data, error } = await supabase
    .from("records")
    .select(`
      id,
      code,
      title,
      project_id,
      record_values!inner (
        value_text,
        fields!inner (field_role)
      )
    `)
    .eq("active", true)
    .eq("record_values.fields.field_role", "email")
    .order("code");

  if (error) throw new Error(`Failed to fetch candidate records: ${error.message}`);

  return (data || [])
    .map((record) => ({
      recordId: record.id,
      code: record.code,
      displayName: record.title || record.code || "Candidate",
      email: record.record_values?.[0]?.value_text || null,
      projectId: record.project_id,
    }))
    .filter((record) => record.email);
}

function toTestUser(user, password) {
  return {
    label: user.label,
    role: user.role,
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    password,
  };
}

async function provisionCandidates(password) {
  const candidates = await getCandidateRecords();
  const testUsers = [];

  for (const candidate of candidates) {
    const authUser = await ensureAuthUser({
      email: candidate.email,
      displayName: candidate.displayName,
      role: "candidate",
      password,
    });

    await ensureProfile({
      id: authUser.id,
      displayName: candidate.displayName,
      role: "candidate",
      candidateRecordId: candidate.recordId,
    });

    await ensureMemberships(authUser.id, [candidate.projectId], "viewer");

    testUsers.push(
      toTestUser(
        {
          label: candidate.code || candidate.displayName,
          role: "candidate",
          userId: authUser.id,
          email: candidate.email,
          displayName: candidate.displayName,
        },
        password,
      ),
    );
  }

  return testUsers;
}

async function provisionStaffLikeUsers(users, projectIds, password) {
  const created = [];

  for (const user of users) {
    const authUser = await ensureAuthUser({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      password,
    });

    await ensureProfile({
      id: authUser.id,
      displayName: user.displayName,
      role: user.role,
    });

    await ensureMemberships(authUser.id, projectIds, user.memberRole);

    created.push(
      toTestUser(
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

async function main() {
  const projects = await getProjects();
  const projectIds = projects.map((project) => project.id);

  if (!projectIds.length) {
    throw new Error("No projects found. Create a project first, then rerun this script.");
  }

  const adminUsers = await provisionStaffLikeUsers(ADMIN_USERS, projectIds, DEFAULT_PASSWORD);
  const clientUsers = await provisionStaffLikeUsers(CLIENT_USERS, projectIds, DEFAULT_PASSWORD);
  const internalUsers = await provisionStaffLikeUsers(INTERNAL_USERS, projectIds, DEFAULT_PASSWORD);
  const candidateUsers = await provisionCandidates(DEFAULT_PASSWORD);

  const summary = {
    password: DEFAULT_PASSWORD,
    projectCount: projectIds.length,
    created: {
      admins: adminUsers,
      clients: clientUsers,
      internals: internalUsers,
      candidates: candidateUsers,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
