import { describe, expect, it, vi } from "vitest";
import { loadUnreadTicketCountsByProject } from "../lib/ticket-nav-badge.js";

function queryResult(result) {
    return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        then(resolve, reject) {
            return Promise.resolve(result).then(resolve, reject);
        },
    };
}

describe("loadUnreadTicketCountsByProject", () => {
    it("uses the aggregate RPC when available", async () => {
        const supabase = {
            rpc: vi.fn().mockResolvedValue({
                data: [{ project_id: "project-1", unread_count: 2, open_count: 5 }],
                error: null,
            }),
            from: vi.fn(),
        };

        const counts = await loadUnreadTicketCountsByProject({
            supabase,
            projectIds: ["project-1"],
            userId: "user-1",
        });

        expect(supabase.rpc).toHaveBeenCalledWith("get_ticket_counts_for_projects", {
            p_project_ids: ["project-1"],
        });
        expect(supabase.from).not.toHaveBeenCalled();
        expect(counts.get("project-1")).toEqual({ unreadCount: 2, openCount: 5 });
    });

    it("falls back to browser-side counting when the RPC is unavailable", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const resultsByTable = {
            requests: {
                data: [
                    { id: "t1", project_id: "project-1", status: "open", created_at: "2024-01-02T00:00:00Z", created_by: "other" },
                    { id: "t2", project_id: "project-1", status: "open", created_at: "2024-01-02T00:00:00Z", created_by: "user-1" },
                    { id: "t3", project_id: "project-1", status: "done", created_at: "2024-01-02T00:00:00Z", created_by: "other" },
                    { id: "t4", project_id: "project-1", status: "open", created_at: "2024-01-02T00:00:00Z", created_by: "other" },
                ],
                error: null,
            },
            ticket_read_states: {
                data: [
                    { ticket_id: "t2", last_read_at: "2024-01-03T00:00:00Z" },
                    { ticket_id: "t4", last_read_at: "2024-01-05T00:00:00Z" },
                ],
                error: null,
            },
            ticket_replies: {
                data: [
                    { ticket_id: "t2", author_id: "other", created_at: "2024-01-04T00:00:00Z" },
                ],
                error: null,
            },
        };
        const supabase = {
            rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("missing function") }),
            from: vi.fn((table) => queryResult(resultsByTable[table])),
        };

        const counts = await loadUnreadTicketCountsByProject({
            supabase,
            projectIds: ["project-1"],
            userId: "user-1",
        });

        expect(supabase.from).toHaveBeenCalledWith("requests");
        expect(counts.get("project-1")).toEqual({ unreadCount: 2, openCount: 3 });
        warn.mockRestore();
    });
});
