function normalizeTicketStatus(value) {
    return String(value || "").trim().toLowerCase() === "done" ? "done" : "open";
}

function getTicketActivityMeta(ticket, replies, userId = "") {
    const currentUserId = String(userId || "");
    const events = [];

    const createdAt = Date.parse(ticket?.created_at || "");
    const createdBy = String(ticket?.created_by || "");
    if (Number.isFinite(createdAt) && createdBy && createdBy !== currentUserId) {
        events.push({ at: createdAt, actorId: createdBy });
    }

    const repliedAt = Date.parse(ticket?.replied_at || "");
    const repliedBy = String(ticket?.replied_by || "");
    if (Number.isFinite(repliedAt) && repliedBy && repliedBy !== currentUserId) {
        events.push({ at: repliedAt, actorId: repliedBy });
    }

    for (const reply of replies || []) {
        const at = Date.parse(reply?.created_at || "");
        const actorId = String(reply?.author_id || "");
        if (!Number.isFinite(at)) continue;
        if (!actorId || actorId === currentUserId) continue;
        events.push({ at, actorId });
    }

    if (!events.length) return { lastAt: 0, actorId: "" };
    events.sort((a, b) => a.at - b.at);
    const last = events[events.length - 1];
    return { lastAt: last.at, actorId: last.actorId };
}

export function isTicketUnreadForUser({ ticket, replies = [], lastReadAt = 0, userId = "" }) {
    if (normalizeTicketStatus(ticket?.status) !== "open") return false;

    const activity = getTicketActivityMeta(ticket, replies, userId);
    return activity.lastAt > (Number(lastReadAt) || 0);
}

function ensureNavBadge(navElement) {
    let badge = navElement?.querySelector?.(".nav-ticket-badge");
    if (badge) return badge;

    badge = document.createElement("span");
    badge.className = "nav-ticket-badge";
    badge.hidden = true;
    badge.setAttribute("aria-live", "polite");
    const lockIcon = navElement?.querySelector?.(".nav-lock");
    if (lockIcon) {
        navElement.insertBefore(badge, lockIcon);
    } else {
        navElement?.appendChild?.(badge);
    }
    return badge;
}

export async function loadUnreadTicketCountsByProject({ supabase, projectIds, userId }) {
    const uniqueProjectIds = [...new Set((projectIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!uniqueProjectIds.length || !userId) return new Map();

    const { data: tickets, error: ticketsError } = await supabase
        .from("requests")
        .select("id, project_id, status, created_at, created_by, replied_at, replied_by")
        .in("project_id", uniqueProjectIds);
    if (ticketsError) throw ticketsError;

    const ticketIds = (tickets || []).map((ticket) => ticket.id).filter(Boolean);
    if (!ticketIds.length) return new Map();

    const readStateByTicket = new Map();
    const repliesByTicket = new Map();

    const { data: readStates, error: readStatesError } = await supabase
        .from("ticket_read_states")
        .select("ticket_id, last_read_at")
        .eq("user_id", userId)
        .in("ticket_id", ticketIds);
    if (readStatesError) throw readStatesError;

    for (const state of (readStates || [])) {
        readStateByTicket.set(String(state.ticket_id || ""), Date.parse(state.last_read_at || "") || 0);
    }

    const { data: replies, error: repliesError } = await supabase
        .from("ticket_replies")
        .select("ticket_id, author_id, created_at")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true });
    if (repliesError) throw repliesError;

    for (const reply of (replies || [])) {
        const ticketId = String(reply.ticket_id || "");
        if (!repliesByTicket.has(ticketId)) repliesByTicket.set(ticketId, []);
        repliesByTicket.get(ticketId).push(reply);
    }

    const countsByProject = new Map();
    for (const ticket of (tickets || [])) {
        if (normalizeTicketStatus(ticket?.status) !== "open") continue;
        const projectId = String(ticket?.project_id || "");
        const currentCounts = countsByProject.get(projectId) || { unreadCount: 0, openCount: 0 };
        currentCounts.openCount += 1;

        const activity = getTicketActivityMeta(
            ticket,
            repliesByTicket.get(String(ticket.id || "")),
            userId
        );
        const lastReadAt = readStateByTicket.get(String(ticket.id || "")) || 0;
        if (activity.lastAt > lastReadAt) {
            currentCounts.unreadCount += 1;
        }

        countsByProject.set(projectId, currentCounts);
    }

    return countsByProject;
}

export function attachTicketNavBadge({ supabase, navElement, getProjectId, getProjectIds, userId, displayMode = "unread_or_open" }) {
    const badge = ensureNavBadge(navElement);

    async function refresh() {
        if (!navElement || !badge || !userId) return;

        try {
            const projectId = typeof getProjectId === "function" ? getProjectId() : getProjectId;
            const projectIds = typeof getProjectIds === "function" ? getProjectIds() : getProjectIds;
            const requestedProjectIds = projectId
                ? [projectId]
                : (Array.isArray(projectIds) ? projectIds : []);

            if (!requestedProjectIds.length) {
                badge.hidden = true;
                badge.textContent = "";
                return;
            }

            const countsByProject = await loadUnreadTicketCountsByProject({
                supabase,
                projectIds: requestedProjectIds,
                userId,
            });

            const totals = projectId
                ? (countsByProject.get(String(projectId)) || { unreadCount: 0, openCount: 0 })
                : [...countsByProject.values()].reduce((sum, counts) => ({
                    unreadCount: sum.unreadCount + Number(counts?.unreadCount || 0),
                    openCount: sum.openCount + Number(counts?.openCount || 0),
                }), { unreadCount: 0, openCount: 0 });

            const displayUnreadOnly = String(displayMode || "").trim().toLowerCase() === "unread_only";
            const displayCount = displayUnreadOnly
                ? totals.unreadCount
                : (totals.unreadCount > 0 ? totals.unreadCount : totals.openCount);

            badge.textContent = displayCount > 99 ? "99+" : String(displayCount);
            badge.hidden = displayCount <= 0;
            badge.classList.toggle("is-open-only", !displayUnreadOnly && totals.unreadCount <= 0 && totals.openCount > 0);
            navElement.classList.toggle("has-ticket-badge", displayCount > 0);
        } catch (error) {
            console.warn("ticket nav badge refresh failed:", error?.message || error);
            badge.hidden = true;
            badge.textContent = "";
            badge.classList.remove("is-open-only");
            navElement.classList.remove("has-ticket-badge");
        }
    }

    return { refresh };
}
