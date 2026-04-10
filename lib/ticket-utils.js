// Pure helper functions for ticket and notification logic.
// Import from this module to keep logic testable outside the browser.

/** Collapse ticket status to either "open" or "done". */
export function normalizeStatus(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return "open";
    if (["done", "closed", "resolved"].includes(s)) return "done";
    return "open";
}

/** Validate and return a canonical priority value. */
export function normalizePriority(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["low", "normal", "high", "urgent"].includes(s)) return s;
    return "normal";
}

/** Human-readable label for an event type (mirrors edge function). */
export function eventLabel(type) {
    if (type === "reply")           return "New Reply";
    if (type === "status_change")   return "Status Changed";
    if (type === "priority_change") return "Priority Changed";
    if (type === "new_ticket")      return "New Request";
    return "Ticket Updated";
}

/** Loose email format check (mirrors server-side regex). */
export function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Decide whether a status_change notification should fire.
 * Clients cannot change status, so we gate on isClient.
 */
export function shouldFireStatusNotification(oldStatus, newStatus, isClient) {
    if (isClient) return false;
    return Boolean(oldStatus && newStatus && oldStatus !== newStatus);
}

/** Decide whether a priority_change notification should fire. */
export function shouldFirePriorityNotification(oldPriority, newPriority) {
    return Boolean(oldPriority && newPriority && oldPriority !== newPriority);
}
