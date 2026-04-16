function normalizeTicketStatus(value) {
    return String(value || "").trim().toLowerCase() === "done" ? "done" : "open";
}

function getTicketActivityMeta(ticket, replies) {
    const events = [];

    const createdAt = Date.parse(ticket?.created_at || "");
    if (Number.isFinite(createdAt)) events.push({ at: createdAt, actorId: String(ticket?.created_by || "") });

    const repliedAt = Date.parse(ticket?.replied_at || "");
    if (Number.isFinite(repliedAt)) events.push({ at: repliedAt, actorId: String(ticket?.replied_by || "") });

    for (const reply of replies || []) {
        const at = Date.parse(reply?.created_at || "");
        if (!Number.isFinite(at)) continue;
        events.push({ at, actorId: String(reply?.author_id || "") });
    }

    if (!events.length) return { lastAt: 0, actorId: "" };
    events.sort((a, b) => a.at - b.at);
    return events[events.length - 1];
}

function ensureNavBadge(navElement) {
    let badge = navElement?.querySelector?.(".nav-ticket-badge");
    if (badge) return badge;

    badge = document.createElement("span");
    badge.className = "nav-ticket-badge";
    badge.hidden = true;
    badge.setAttribute("aria-live", "polite");
    navElement?.appendChild?.(badge);
    return badge;
}

export function attachTicketNavBadge({ supabase, navElement, getProjectId, userId }) {
    const badge = ensureNavBadge(navElement);

    async function refresh() {
        if (!navElement || !badge || !userId) return;

        try {
            const projectId = typeof getProjectId === "function" ? getProjectId() : getProjectId;
            if (!projectId) {
                badge.hidden = true;
                badge.textContent = "";
                return;
            }

            const { data: tickets, error: ticketsError } = await supabase
                .from("requests")
                .select("id, status, created_at, created_by, replied_at, replied_by")
                .eq("project_id", projectId);
            if (ticketsError) throw ticketsError;

            const ticketIds = (tickets || []).map((ticket) => ticket.id).filter(Boolean);
            if (!ticketIds.length) {
                badge.hidden = true;
                badge.textContent = "";
                return;
            }

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

            let unreadCount = 0;
            for (const ticket of (tickets || [])) {
                if (normalizeTicketStatus(ticket?.status) !== "open") continue;
                const activity = getTicketActivityMeta(ticket, repliesByTicket.get(String(ticket.id || "")));
                const lastReadAt = readStateByTicket.get(String(ticket.id || "")) || 0;
                if (activity.lastAt > lastReadAt && activity.actorId && activity.actorId !== userId) {
                    unreadCount += 1;
                }
            }

            badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
            badge.hidden = unreadCount <= 0;
            navElement.classList.toggle("has-ticket-badge", unreadCount > 0);
        } catch (error) {
            console.warn("ticket nav badge refresh failed:", error?.message || error);
            badge.hidden = true;
            badge.textContent = "";
            navElement.classList.remove("has-ticket-badge");
        }
    }

    return { refresh };
}
