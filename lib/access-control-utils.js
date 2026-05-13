// English comments only

export function normalizeRole(value, fallback = "viewer") {
    const role = String(value || "").trim().toLowerCase();
    return role || fallback;
}

export function resolveRoleFromSources({ profileRole, session, cachedRole, fallback = "viewer" } = {}) {
    const profileValue = normalizeRole(profileRole, "");
    if (profileValue) return profileValue;

    const metadataValue = normalizeRole(session?.user?.user_metadata?.role, "");
    if (metadataValue) return metadataValue;

    const cachedValue = normalizeRole(cachedRole, "");
    return cachedValue || fallback;
}

export function getFormAccessDecision(role) {
    const normalizedRole = normalizeRole(role, "external");
    if (normalizedRole === "admin" || normalizedRole === "internal") {
        return { ok: true, role: normalizedRole, redirectTo: null };
    }
    if (normalizedRole === "participant") {
        return { ok: false, role: normalizedRole, redirectTo: "./participant-status.html" };
    }
    return { ok: false, role: normalizedRole, redirectTo: "./projects.html" };
}

export function getAdminAccessDecision(role) {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole === "admin") {
        return { ok: true, role: normalizedRole, redirectTo: null };
    }
    return { ok: false, role: normalizedRole, redirectTo: "./projects.html" };
}

export function getProjectsAccessDecision(role) {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole === "participant") {
        return { ok: false, role: normalizedRole, redirectTo: "./participant-status.html" };
    }
    return { ok: true, role: normalizedRole, redirectTo: null };
}

export function canManageProjectSettings({ profileRole, memberRole, projectCreatedBy, userId } = {}) {
    const role = normalizeRole(profileRole);
    const projectRole = normalizeRole(memberRole, "");
    const callerId = String(userId || "");
    if (role === "admin") return true;
    return role === "internal"
        && Boolean(callerId)
        && (
            String(projectCreatedBy || "") === callerId
            || projectRole === "admin"
            || projectRole === "editor"
        );
}

export function getProjectSettingsAccessDecision(args = {}) {
    const role = normalizeRole(args.profileRole);
    if (canManageProjectSettings(args)) {
        return { ok: true, role, redirectTo: null };
    }
    return { ok: false, role, redirectTo: "./projects.html" };
}

export function resolveCronSecretAccess({ secret, header, source, secretName = "CRON_SECRET" } = {}) {
    const configuredSecret = String(secret || "").trim();
    const providedHeader = String(header || "").trim();
    const requestedSource = String(source || "").trim().toLowerCase();
    const wantsCron = Boolean(providedHeader) || requestedSource === "cron";

    if (!wantsCron) {
        return { requestedByCron: false, error: null };
    }
    if (!configuredSecret) {
        return {
            requestedByCron: false,
            error: { status: 500, message: `${secretName} is not configured` },
        };
    }
    if (providedHeader !== configuredSecret) {
        return {
            requestedByCron: false,
            error: { status: 401, message: "Unauthorized" },
        };
    }
    return { requestedByCron: true, error: null };
}

export function resolveManualProjectEmailAccess({
    requestedByCron,
    manualUserId,
    projectId,
    canManageProject,
} = {}) {
    if (requestedByCron) return { ok: true, status: 200, error: null };
    if (!manualUserId) return { ok: false, status: 401, error: "Unauthorized" };
    if (!projectId) return { ok: false, status: 400, error: "projectId is required for manual sends" };
    if (!canManageProject) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true, status: 200, error: null };
}
