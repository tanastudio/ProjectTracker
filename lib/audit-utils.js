export const AUDIT_ACTION_LABELS = {
    INSERT: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
};

export function normaliseAuditAction(action) {
    return String(action || "").trim().toUpperCase();
}

export function getAuditActionLabel(action) {
    const key = normaliseAuditAction(action);
    return AUDIT_ACTION_LABELS[key] || key || "Unknown";
}

export function getAuditActionClass(action) {
    const key = normaliseAuditAction(action);
    if (key === "INSERT") return "is-create";
    if (key === "UPDATE") return "is-update";
    if (key === "DELETE") return "is-delete";
    return "";
}

export function formatAuditActor(log) {
    const actorName = String(log?.actor_email || log?.actor_user_id || "").trim();
    const role = String(log?.actor_role || "").trim();

    if (!actorName && !role) return "System";
    if (!actorName) return role;
    if (!role) return actorName;
    return `${actorName} (${role})`;
}

export function getChangedFieldNames(changedFields) {
    if (!changedFields || typeof changedFields !== "object" || Array.isArray(changedFields)) {
        return [];
    }

    return Object.keys(changedFields).sort((a, b) => a.localeCompare(b));
}

export function formatChangedFields(changedFields) {
    const names = getChangedFieldNames(changedFields);
    return names.length ? names.join(", ") : "-";
}
