import { describe, it, expect, vi } from "vitest";
import { validateInput, findAuthUserByEmail } from "../lib/admin-utils.js";

// ── validateInput ─────────────────────────────────────────────────────────────

describe("validateInput", () => {
    it("returns ok=true for valid input", () => {
        const result = validateInput({
            email: "user@example.com",
            display_name: "Alice",
            project_id: "proj-uuid-1",
        });
        expect(result).toEqual({
            ok: true,
            email: "user@example.com",
            displayName: "Alice",
            projectId: "proj-uuid-1",
        });
    });

    it("normalises email to lowercase and trims whitespace", () => {
        const result = validateInput({
            email: "  USER@EXAMPLE.COM  ",
            display_name: "Alice",
            project_id: "proj-1",
        });
        expect(result.ok).toBe(true);
        expect(result.email).toBe("user@example.com");
    });

    it("fails when email is missing", () => {
        const result = validateInput({ display_name: "Alice", project_id: "p1" });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("fails when display_name is missing", () => {
        const result = validateInput({ email: "a@b.com", project_id: "p1" });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("fails when project_id is missing", () => {
        const result = validateInput({ email: "a@b.com", display_name: "Alice" });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("fails for invalid email format", () => {
        const result = validateInput({
            email: "not-an-email",
            display_name: "Alice",
            project_id: "p1",
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/invalid email/i);
    });

    it("handles null/undefined body gracefully", () => {
        expect(validateInput(null).ok).toBe(false);
        expect(validateInput(undefined).ok).toBe(false);
        expect(validateInput({}).ok).toBe(false);
    });
});

// ── findAuthUserByEmail ───────────────────────────────────────────────────────

function makeClient(pages) {
    // pages: array of user arrays, one array per page
    let callCount = 0;
    return {
        auth: {
            admin: {
                listUsers: vi.fn(async ({ page, perPage }) => {
                    const idx = (page ?? 1) - 1;
                    const users = pages[idx] ?? [];
                    return { data: { users }, error: null };
                }),
            },
        },
    };
}

describe("findAuthUserByEmail", () => {
    it("returns the user id when found on the first page", async () => {
        const client = makeClient([
            [{ id: "uid-1", email: "alice@example.com" }, { id: "uid-2", email: "bob@example.com" }],
        ]);
        const id = await findAuthUserByEmail(client, "alice@example.com");
        expect(id).toBe("uid-1");
        expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(1);
    });

    it("paginates to the second page when user is not on the first", async () => {
        const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `uid-${i}`, email: `user${i}@example.com` }));
        const page2 = [{ id: "uid-target", email: "target@example.com" }];
        const client = makeClient([page1, page2]);

        const id = await findAuthUserByEmail(client, "target@example.com");
        expect(id).toBe("uid-target");
        expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(2);
    });

    it("returns null when the user is not found after all pages are exhausted", async () => {
        const client = makeClient([
            [{ id: "uid-1", email: "someone@example.com" }],
        ]);
        const id = await findAuthUserByEmail(client, "missing@example.com");
        expect(id).toBeNull();
    });

    it("returns null when the API returns an error", async () => {
        const client = {
            auth: {
                admin: {
                    listUsers: vi.fn(async () => ({ data: null, error: new Error("API error") })),
                },
            },
        };
        const id = await findAuthUserByEmail(client, "any@example.com");
        expect(id).toBeNull();
    });

    it("stops after the last partial page without making extra requests", async () => {
        // Two pages: first full (1000), second partial (5) — user not present
        const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.com` }));
        const page2 = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, email: `v${i}@x.com` }));
        const client = makeClient([page1, page2]);

        await findAuthUserByEmail(client, "ghost@example.com");
        expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(2); // stopped after page2
    });
});
