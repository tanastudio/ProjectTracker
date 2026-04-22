import { describe, expect, it } from "vitest";
import {
    formatAuditActor,
    formatChangedFields,
    getAuditActionClass,
    getAuditActionLabel,
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
