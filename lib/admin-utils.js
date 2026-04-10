// Pure helper functions extracted from the admin-create-user edge function.
// These contain no Supabase/Deno dependencies so they can be tested in Node.js.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalise the JSON body sent to admin-create-user.
 * Returns { ok: true, ...fields } or { ok: false, error: string }.
 */
export function validateInput(body) {
    const email       = String(body?.email        ?? "").trim().toLowerCase();
    const displayName = String(body?.display_name ?? "").trim();
    const projectId   = String(body?.project_id   ?? "").trim();

    if (!email || !displayName || !projectId) {
        return { ok: false, error: "email, display_name, and project_id are required" };
    }
    if (!EMAIL_RE.test(email)) {
        return { ok: false, error: `Invalid email format: ${email}` };
    }
    return { ok: true, email, displayName, projectId };
}

/**
 * Paginate through Supabase admin.listUsers to find a user by email.
 * Returns the user id string, or null if not found.
 * @param {{ auth: { admin: { listUsers: Function } } }} adminClient
 * @param {string} email
 */
export async function findAuthUserByEmail(adminClient, email) {
    const perPage = 1000;
    let page      = 1;

    while (true) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
        if (error || !data?.users) return null;

        const found = data.users.find((u) => u.email === email);
        if (found) return found.id;

        if (data.users.length < perPage) return null; // last page reached
        page++;
    }
}
