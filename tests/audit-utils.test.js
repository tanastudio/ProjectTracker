import { describe, expect, it } from "vitest";
import {
    formatAuditActor,
    formatAuditUser,
    formatChangedFields,
    getAuditActionClass,
    getAuditActionLabel,
    getAuditUserId,
    getChangedFieldNames,
} from "../lib/audit-utils.js";

describe("audit-utils", () => {
    it("maps action labels and classes", () => {
        expect(getAuditActionLabel("insert")).toBe("Created");
        expect(getAuditActionLabel("UPDATE")).toBe("Updated");
        expect(getAuditActionLabel("delete")).toBe("Deleted");
        expect(getAuditActionClass("insert")).toBe("is-create");
        expect(getAuditActionClass("UPDATE")).toBe("is-update");
        expect(getAuditActionClass("delete")).toBe("is-delete");
    });

    it("formats actor details", () => {
        expect(formatAuditActor({ actor_email: "admin@example.com", actor_role: "admin" })).toBe("admin@example.com (admin)");
        expect(formatAuditActor({ actor_user_id: "user-1" })).toBe("user-1");
        expect(formatAuditActor({})).toBe("System");
    });

    it("resolves the affected profile user when actor is missing", () => {
        const log = {
            actor_role: "viewer",
            table_name: "profiles",
            entity_id: "user-1",
            new_data: { id: "user-1", display_name: "Admin Test" },
        };
        const profilesById = new Map([
            ["user-1", { display_name: "Admin Test", role: "admin" }],
        ]);

        expect(getAuditUserId(log)).toBe("user-1");
        expect(formatAuditUser(log, profilesById)).toBe("Admin Test (admin)");
    });

    it("resolves project member user ids from composite entity ids", () => {
        const log = {
            actor_role: "viewer",
            table_name: "project_members",
            entity_id: "user-2:project-1",
        };

        expect(getAuditUserId(log)).toBe("user-2");
        expect(formatAuditUser(log)).toBe("user-2");
    });

    it("formats changed fields in stable order", () => {
        const changed = {
            status: { old: "open", new: "closed" },
            priority: { old: "normal", new: "high" },
        };

        expect(getChangedFieldNames(changed)).toEqual(["priority", "status"]);
        expect(formatChangedFields(changed)).toBe("priority, status");
        expect(formatChangedFields(null)).toBe("-");
    });
});
