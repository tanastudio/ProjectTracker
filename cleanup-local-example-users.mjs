import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SECRET =
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAILS_TO_DELETE = [
  "client.a@example.com",
  "client.b@example.com",
  "client.c@example.com",
  "internal.a@example.com",
  "internal.b@example.com",
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

async function main() {
  const users = await listAllUsers();
  const targets = users.filter((user) =>
    EMAILS_TO_DELETE.includes(String(user.email || "").toLowerCase()),
  );

  const deleted = [];
  const missing = EMAILS_TO_DELETE.filter(
    (email) => !targets.some((user) => String(user.email || "").toLowerCase() === email),
  );

  for (const user of targets) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser failed for ${user.email}: ${error.message}`);
    deleted.push({ id: user.id, email: user.email });
  }

  console.log(JSON.stringify({ deleted, missing }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
