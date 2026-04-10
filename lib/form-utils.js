// Pure helper functions for step-status logic used in form.js
// Import from this module to keep logic testable outside the browser.

export const STEP_STATUS = ["Not Started", "In Progress", "Completed", "Issue"];

/**
 * Normalise a raw status value against a field's option list.
 * Falls back to STEP_STATUS when options is absent/empty.
 */
export function normalizeStatus(v, options) {
    const s     = String(v || "").trim();
    const valid = (Array.isArray(options) && options.length) ? options : STEP_STATUS;
    return valid.includes(s) ? s : (valid[0] ?? "Not Started");
}

/**
 * Derive the overall status from an array of individual step statuses.
 * Priority: Issue > Completed (all) > In Progress > Not Started.
 */
export function computeOverall(stepStatuses) {
    if (stepStatuses.length === 0) return "Not Started";

    const hasIssue      = stepStatuses.some(s => s === "Issue");
    const hasInProgress = stepStatuses.some(s => s === "In Progress");
    const hasCompleted  = stepStatuses.some(s => s === "Completed");
    const hasNotStarted = stepStatuses.some(s => s === "Not Started");
    const allCompleted  = stepStatuses.every(s => s === "Completed");

    if (hasIssue)                      return "Issue";
    if (allCompleted)                  return "Completed";
    if (hasInProgress)                 return "In Progress";
    if (hasCompleted && hasNotStarted) return "In Progress";
    return "Not Started";
}
