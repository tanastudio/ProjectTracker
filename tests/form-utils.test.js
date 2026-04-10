import { describe, it, expect } from "vitest";
import { STEP_STATUS, normalizeStatus, computeOverall } from "../lib/form-utils.js";

describe("STEP_STATUS", () => {
    it("contains exactly the four expected values", () => {
        expect(STEP_STATUS).toEqual(["Not Started", "In Progress", "Completed", "Issue"]);
    });
});

describe("normalizeStatus", () => {
    it("returns value as-is when it matches the default list", () => {
        expect(normalizeStatus("In Progress")).toBe("In Progress");
        expect(normalizeStatus("Issue")).toBe("Issue");
        expect(normalizeStatus("Completed")).toBe("Completed");
        expect(normalizeStatus("Not Started")).toBe("Not Started");
    });

    it("falls back to first default value for unknown input", () => {
        expect(normalizeStatus("unknown")).toBe("Not Started");
        expect(normalizeStatus("")).toBe("Not Started");
        expect(normalizeStatus(null)).toBe("Not Started");
        expect(normalizeStatus(undefined)).toBe("Not Started");
    });

    it("respects a custom options list", () => {
        const opts = ["Pending", "Active", "Done"];
        expect(normalizeStatus("Active", opts)).toBe("Active");
        expect(normalizeStatus("unknown", opts)).toBe("Pending");
    });

    it("falls back to STEP_STATUS when options is empty", () => {
        expect(normalizeStatus("Completed", [])).toBe("Completed");
    });
});

describe("computeOverall", () => {
    it("returns Not Started for empty array", () => {
        expect(computeOverall([])).toBe("Not Started");
    });

    it("returns Not Started when all steps are Not Started", () => {
        expect(computeOverall(["Not Started", "Not Started"])).toBe("Not Started");
    });

    it("returns Issue when any step is Issue (highest priority)", () => {
        expect(computeOverall(["Issue", "Completed"])).toBe("Issue");
        expect(computeOverall(["In Progress", "Issue"])).toBe("Issue");
    });

    it("returns Completed when all steps are Completed", () => {
        expect(computeOverall(["Completed", "Completed"])).toBe("Completed");
    });

    it("returns In Progress when any step is In Progress (no Issue)", () => {
        expect(computeOverall(["Not Started", "In Progress"])).toBe("In Progress");
    });

    it("returns In Progress when mix of Completed and Not Started", () => {
        expect(computeOverall(["Completed", "Not Started"])).toBe("In Progress");
    });

    it("Issue beats Completed", () => {
        expect(computeOverall(["Completed", "Completed", "Issue"])).toBe("Issue");
    });

    it("handles single-step arrays", () => {
        expect(computeOverall(["Completed"])).toBe("Completed");
        expect(computeOverall(["Issue"])).toBe("Issue");
    });
});
