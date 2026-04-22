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

function firstStringValue(...values) {
    for (const value of values) {
        const text = String(value || "").trim();
        if (text) return text;
    }

    return "";
}

export function getAuditUserId(log) {
    const oldData = log?.old_data || {};
    const newData = log?.new_data || {};
    const tableName = String(log?.table_name || "");

    const directActorId = firstStringValue(log?.actor_user_id);
    if (directActorId) return directActorId;

    if (tableName === "profiles") {
        return firstStringValue(newData.id, oldData.id, log?.entity_id);
    }

    if (tableName === "project_members") {
        const entityUserId = String(log?.entity_id || "").split(":")[0];
        return firstStringValue(newData.user_id, oldData.user_id, entityUserId);
    }

    if (tableName === "client_record_assignments") {
        const entityUserId = String(log?.entity_id || "").split(":")[0];
        return firstStringValue(newData.client_user_id, oldData.client_user_id, entityUserId);
    }

    return firstStringValue(
        newData.user_id,
        oldData.user_id,
        newData.author_id,
        oldData.author_id,
        newData.created_by,
        oldData.created_by,
        newData.updated_by,
        oldData.updated_by,
        newData.replied_by,
        oldData.replied_by,
    );
}

export function formatAuditUser(log, profilesById = new Map()) {
    const userId = getAuditUserId(log);
    const profile = userId ? profilesById.get(String(userId)) : null;

    if (profile) {
        const name = String(profile.display_name || profile.email || userId).trim();
        const role = String(profile.role || "").trim();
        return role ? `${name} (${role})` : name;
    }

    const fallback = formatAuditActor(log);
    return fallback === "viewer" && userId ? userId : fallback;
}

export function isAuditLogForUser(log, userId) {
    const expected = String(userId || "").trim();
    if (!expected) return true;
    return getAuditUserId(log) === expected;
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
