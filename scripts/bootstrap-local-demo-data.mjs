import { createClient } from "@supabase/supabase-js";

const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:55321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET;
const ADMIN_EMAIL = process.env.LOCAL_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || "Admin1234!";

if (!SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET");
}

const supabase = createClient(LOCAL_SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PROJECTS = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    name: "Sample Project",
    description: "Local demo project used for client-facing summaries.",
    status: "active",
    code_prefix: "SAMP",
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    name: "Portfolio Demo Project",
    description: "Second active project used for internal portfolio summaries.",
    status: "active",
    code_prefix: "PORT",
  },
];

const PROJECT_FIELDS = [
  {
    projectId: PROJECTS[0].id,
    fields: [
      field("20000000-0000-0000-0000-000000000001", "document_check", "Document Check", "select", 10, "step", ["Not Started", "In Progress", "Completed", "Issue"], true),
      field("20000000-0000-0000-0000-000000000006", "assessments", "Assessments", "select", 20, "step", ["Not Started", "In Progress", "Completed", "Issue"], true),
      field("20000000-0000-0000-0000-000000000002", "email", "Email", "text", 15, "email", null, false),
      field("20000000-0000-0000-0000-000000000003", "issue", "Issue", "text", 100, "issue", null, false),
      field("20000000-0000-0000-0000-000000000004", "decision", "Decision", "text", 110, "decision", null, false),
      field("20000000-0000-0000-0000-000000000005", "overall_status", "Overall Status", "select", 999, "overall_status", ["Not Started", "In Progress", "Completed", "Issue"], true),
    ],
  },
  {
    projectId: PROJECTS[1].id,
    fields: [
      field("21000000-0000-0000-0000-000000000001", "screening", "Screening", "select", 10, "step", ["Not Started", "In Progress", "Completed", "Issue"], true),
      field("21000000-0000-0000-0000-000000000006", "interview", "Interview", "select", 20, "step", ["Not Started", "In Progress", "Completed", "Issue"], true),
      field("21000000-0000-0000-0000-000000000002", "email", "Email", "text", 15, "email", null, false),
      field("21000000-0000-0000-0000-000000000003", "issue", "Issue", "text", 100, "issue", null, false),
      field("21000000-0000-0000-0000-000000000004", "decision", "Decision", "text", 110, "decision", null, false),
      field("21000000-0000-0000-0000-000000000005", "overall_status", "Overall Status", "select", 999, "overall_status", ["Not Started", "In Progress", "Completed", "Issue"], true),
    ],
  },
];

const DEMO_RECORDS = [
  record("30000000-0000-0000-0000-000000000001", PROJECTS[0].id, "SAMP-0001", "Sample Participant"),
  record("30000000-0000-0000-0000-000000000002", PROJECTS[0].id, "SAMP-0002", "Alice Johnson"),
  record("30000000-0000-0000-0000-000000000003", PROJECTS[0].id, "SAMP-0003", "Bob Smith"),
  record("31000000-0000-0000-0000-000000000001", PROJECTS[1].id, "PORT-0001", "Mina Patel"),
  record("31000000-0000-0000-0000-000000000002", PROJECTS[1].id, "PORT-0002", "Noah Reed"),
  record("31000000-0000-0000-0000-000000000003", PROJECTS[1].id, "PORT-0003", "Olivia Chen"),
];

const DEMO_VALUES = [
  value("30000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000001", null, "In Progress"),
  value("30000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000006", null, "In Progress"),
  value("30000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002", "localtest.cand001@inbox.testmail.app", null),
  value("30000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000005", null, "In Progress"),

  value("30000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000001", null, "Completed"),
  value("30000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000006", null, "Completed"),
  value("30000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000002", "localtest.cand002@inbox.testmail.app", null),
  value("30000000-0000-0000-0000-000000000002", "20000000-0000-0000-0000-000000000005", null, "Completed"),

  value("30000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000001", null, "Issue"),
  value("30000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000006", null, "Not Started"),
  value("30000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000002", "localtest.cand003@inbox.testmail.app", null),
  value("30000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000003", "Missing transcript", null),
  value("30000000-0000-0000-0000-000000000003", "20000000-0000-0000-0000-000000000005", null, "Issue"),

  value("31000000-0000-0000-0000-000000000001", "21000000-0000-0000-0000-000000000001", null, "Completed"),
  value("31000000-0000-0000-0000-000000000001", "21000000-0000-0000-0000-000000000006", null, "Completed"),
  value("31000000-0000-0000-0000-000000000001", "21000000-0000-0000-0000-000000000002", "localtest.cand004@inbox.testmail.app", null),
  value("31000000-0000-0000-0000-000000000001", "21000000-0000-0000-0000-000000000005", null, "Completed"),

  value("31000000-0000-0000-0000-000000000002", "21000000-0000-0000-0000-000000000001", null, "In Progress"),
  value("31000000-0000-0000-0000-000000000002", "21000000-0000-0000-0000-000000000006", null, "Not Started"),
  value("31000000-0000-0000-0000-000000000002", "21000000-0000-0000-0000-000000000002", "localtest.cand005@inbox.testmail.app", null),
  value("31000000-0000-0000-0000-000000000002", "21000000-0000-0000-0000-000000000005", null, "In Progress"),

  value("31000000-0000-0000-0000-000000000003", "21000000-0000-0000-0000-000000000001", null, "Not Started"),
  value("31000000-0000-0000-0000-000000000003", "21000000-0000-0000-0000-000000000006", null, "Not Started"),
  value("31000000-0000-0000-0000-000000000003", "21000000-0000-0000-0000-000000000002", "localtest.cand006@inbox.testmail.app", null),
  value("31000000-0000-0000-0000-000000000003", "21000000-0000-0000-0000-000000000005", null, "Not Started"),
];

function field(id, key, label, type, sortOrder, fieldRole, options, showInDashboard) {
  return {
    id,
    key,
    label,
    type,
    sort_order: sortOrder,
    field_role: fieldRole,
    options,
    is_active: true,
    visible: true,
    show_in_dashboard: showInDashboard,
  };
}

function record(id, projectId, code, title) {
  return {
    id,
    project_id: projectId,
    code,
    title,
    active: true,
  };
}

function value(recordId, fieldId, valueText, valueSelect) {
  return {
    record_id: recordId,
    field_id: fieldId,
    value_text: valueText,
    value_select: valueSelect,
  };
}

async function ensureAdminUser() {
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw listError;

  const existing = (usersData.users || []).find((user) => String(user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase());

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Local Admin", role: "admin" },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Local Admin", role: "admin" },
  });
  if (error) throw error;
  return data.user;
}

async function upsertProjects(adminUserId) {
  const payload = PROJECTS.map((project) => ({
    ...project,
    created_by: adminUserId,
  }));

  const { error } = await supabase.from("projects").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

async function upsertFields() {
  const payload = PROJECT_FIELDS.flatMap((projectGroup) =>
    projectGroup.fields.map((projectField) => ({
      ...projectField,
      project_id: projectGroup.projectId,
    }))
  );
  const { error } = await supabase.from("fields").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

async function upsertRecords(adminUserId) {
  const payload = DEMO_RECORDS.map((demoRecord) => ({
    ...demoRecord,
    updated_by: adminUserId,
  }));
  const { error } = await supabase.from("records").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

async function upsertRecordValues() {
  const { error } = await supabase.from("record_values").upsert(DEMO_VALUES, { onConflict: "record_id,field_id" });
  if (error) throw error;
}

async function upsertSettings(adminUserId) {
  const payload = PROJECTS.map((project) => ({
    project_id: project.id,
    created_by: adminUserId,
    updated_by: adminUserId,
  }));
  const { error } = await supabase.from("project_update_email_settings").upsert(payload, { onConflict: "project_id" });
  if (error) throw error;
}

async function upsertProfileAndMembership(adminUserId) {
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: adminUserId,
    display_name: "Local Admin",
    role: "admin",
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const memberships = PROJECTS.map((project) => ({
    user_id: adminUserId,
    project_id: project.id,
    role: "editor",
  }));
  const { error: membershipError } = await supabase.from("project_members").upsert(memberships, { onConflict: "user_id,project_id" });
  if (membershipError) throw membershipError;
}

async function main() {
  const adminUser = await ensureAdminUser();
  await upsertProjects(adminUser.id);
  await upsertProfileAndMembership(adminUser.id);
  await upsertFields();
  await upsertRecords(adminUser.id);
  await upsertRecordValues();
  await upsertSettings(adminUser.id);

  console.log(JSON.stringify({
    ok: true,
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
    projects: PROJECTS.map((project) => ({ id: project.id, name: project.name })),
    participantEmails: DEMO_VALUES
      .filter((entry) => entry.value_text && entry.value_text.startsWith("localtest.cand"))
      .map((entry) => entry.value_text),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
