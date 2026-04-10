import { describe, it, expect } from "vitest";
import {
    normalizeStatus,
    normalizePriority,
    eventLabel,
    isValidEmail,
    shouldFireStatusNotification,
    shouldFirePriorityNotification,
} from "../lib/ticket-utils.js";

describe("normalizeStatus (ticket)", () => {
    it("maps closed/resolved/done to 'done'", () => {
        expect(normalizeStatus("closed")).toBe("done");
        expect(normalizeStatus("resolved")).toBe("done");
        expect(normalizeStatus("done")).toBe("done");
        expect(normalizeStatus("Done")).toBe("done");
    });

    it("maps anything else to 'open'", () => {
        expect(normalizeStatus("open")).toBe("open");
        expect(normalizeStatus("in-progress")).toBe("open");
        expect(normalizeStatus("")).toBe("open");
        expect(normalizeStatus(null)).toBe("open");
        expect(normalizeStatus(undefined)).toBe("open");
    });
});

describe("normalizePriority", () => {
    it("passes through valid priority values", () => {
        for (const p of ["low", "normal", "high", "urgent"]) {
            expect(normalizePriority(p)).toBe(p);
        }
    });

    it("is case-insensitive", () => {
        expect(normalizePriority("HIGH")).toBe("high");
        expect(normalizePriority("Normal")).toBe("normal");
    });

    it("defaults to 'normal' for unknown input", () => {
        expect(normalizePriority("critical")).toBe("normal");
        expect(normalizePriority("")).toBe("normal");
        expect(normalizePriority(null)).toBe("normal");
    });
});

describe("eventLabel", () => {
    it("returns correct labels for all known event types", () => {
        expect(eventLabel("reply")).toBe("New Reply");
        expect(eventLabel("status_change")).toBe("Status Changed");
        expect(eventLabel("priority_change")).toBe("Priority Changed");
        expect(eventLabel("new_ticket")).toBe("New Request");
        expect(eventLabel("ticket_updated")).toBe("Ticket Updated");
    });

    it("falls back to 'Ticket Updated' for unknown type", () => {
        expect(eventLabel("unknown")).toBe("Ticket Updated");
        expect(eventLabel("")).toBe("Ticket Updated");
    });
});

describe("isValidEmail", () => {
    it("accepts valid email addresses", () => {
        expect(isValidEmail("user@example.com")).toBe(true);
        expect(isValidEmail("user.name+tag@sub.domain.co")).toBe(true);
    });

    it("rejects malformed email addresses", () => {
        expect(isValidEmail("not-an-email")).toBe(false);
        expect(isValidEmail("@nodomain")).toBe(false);
        expect(isValidEmail("noatsign.com")).toBe(false);
        expect(isValidEmail("spaces @domain.com")).toBe(false);
        expect(isValidEmail("")).toBe(false);
    });
});

describe("shouldFireStatusNotification", () => {
    it("fires when status changed and user is not client", () => {
        expect(shouldFireStatusNotification("open", "done", false)).toBe(true);
    });

    it("does not fire when values are the same", () => {
        expect(shouldFireStatusNotification("open", "open", false)).toBe(false);
    });

    it("does not fire when user is client (clients cannot change status)", () => {
        expect(shouldFireStatusNotification("open", "done", true)).toBe(false);
    });

    it("does not fire when either value is falsy", () => {
        expect(shouldFireStatusNotification(null, "done", false)).toBe(false);
        expect(shouldFireStatusNotification("open", null, false)).toBe(false);
    });
});

describe("shouldFirePriorityNotification", () => {
    it("fires when priority changed", () => {
        expect(shouldFirePriorityNotification("normal", "high")).toBe(true);
    });

    it("does not fire when priority is the same", () => {
        expect(shouldFirePriorityNotification("high", "high")).toBe(false);
    });

    it("does not fire when either value is falsy", () => {
        expect(shouldFirePriorityNotification(null, "high")).toBe(false);
        expect(shouldFirePriorityNotification("normal", null)).toBe(false);
    });
});
