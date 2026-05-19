import { supabase } from "./supabaseClient.js";
import { attachTicketNavBadge } from "./lib/ticket-nav-badge.js";
import { bookingMapKey, formatBookingDateTime, formatBookingSessionStatus, isBookingField } from "./lib/booking-utils.js";

/* ---------- Config ---------- */
const DEFAULT_PROJECT_NAME = "Project ABC";

/* ---------- Status + Columns ---------- */
const STEP_STATUS = ["Not Started", "In Progress", "Completed", "Issue"];
const STEP_KEYS = [
    { key: "learnworlds", label: "LearnWorlds Registered" },
    { key: "hogan", label: "Hogan Assessment" },
    { key: "hogan_status", label: "Hogan Status" },
    { key: "gcat_id", label: "GCAT ID" },
    { key: "gcat_status", label: "GCAT Status" },
    { key: "cbi_booking", label: "CBI Booking" },
    { key: "simulation_booking", label: "Simulation Booking" },
    { key: "feedback_booking", label: "Feedback Booking" },
];

// dynamic text fields we want to show as fixed columns in the table UI
const TEXT_KEYS = ["email", "issue", "decision"];

/* ---------- UI ---------- */
const el = (id) => document.getElementById(id);

const pageSkeleton = el("pageSkeleton");
const tbody = el("tbody");
const refreshBtn = el("refreshBtn");
const autoRefresh = el("autoRefresh");
const lastRefresh = el("lastRefresh");

const kpiTotal = el("kpiTotal");
const kpiCompleted = el("kpiCompleted");
const kpiInProgress = el("kpiInProgress");
const kpiIssue = el("kpiIssue");
const kpiNotStarted = el("kpiNotStarted");

const statusModal = el("statusModal");
const modalTitle = el("modalTitle");
const modalSub = el("modalSub");
const modalTbody = el("modalTbody");
const modalCloseBtn2 = el("modalCloseBtn2");

const requestModal = el("requestModal");
const reqTitle = el("reqTitle");
const reqSub = el("reqSub");
const reqTo = el("reqTo");
const reqSubject = el("reqSubject");
const reqMessage = el("reqMessage");
const reqHint = el("reqHint");
const reqCancelBtn = el("reqCancelBtn");
const reqSendBtn = el("reqSendBtn");

const kpiCards = document.querySelectorAll(".kpi-click");

const dashboardTableWrap = el("dashboardTableWrap");
const dashboardTable = el("dashboardTable");

const dashSearchInput = el("dashSearchInput");
const dashFilterColumn = el("dashFilterColumn");
const dashFilterStatus = el("dashFilterStatus");
const exportMenuBtn = el("exportMenuBtn");
const exportMenu = el("exportMenu");
const exportCsvBtn = el("exportCsvBtn");
const exportXlsxBtn = el("exportXlsxBtn");
const dashboardPager = el("dashboardPager");

let CURRENT_ITEMS = [];
let REQ_CONTEXT = null;
let REQ_SAVED_TICKET_ID = "";
let TICKET_STATS_BY_RECORD = new Map();
const DASHBOARD_PAGE_SIZE = 100;
let dashboardPage = 1;
let dashboardRenderedItems = [];

function hidePageSkeleton() {
    if (pageSkeleton) pageSkeleton.hidden = true;
    document.body.classList.remove("is-page-loading");
}

/* ---------- Auth ---------- */
async function requireSession() {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;

    if (!session) {
        window.location.replace("./index.html");
        return null;
    }

    // ✅ Participant guard must run BEFORE returning session
    const user = session.user;

    const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

    if (!profErr && prof?.role === "participant") {
        window.location.replace("./participant-status.html");
        return null;
    }

    supabase.auth.onAuthStateChange((_evt, s) => {
        if (!s) window.location.replace("./index.html");
    });

    return session;
}

const __session = await requireSession();
if (!__session) throw new Error("No session");

// --- User chip + Sidebar nav + Logout ---
const userChip = document.getElementById("userChip");
const logoutBtn = document.getElementById("logoutBtn");

const navProjects = document.getElementById("navProjects");
const navDashboard = document.getElementById("navDashboard");
const navTickets = document.getElementById("navTickets");
const navUpdateStatus = document.getElementById("navUpdateStatus");
const navProjectSettings = document.getElementById("navProjectSettings");
const navAdmin = document.getElementById("navAdmin");

let USER_ROLE = "unknown";
let USER_DISPLAY_NAME = "";

function goProjectPage(page, projectId) {
    const pid = String(projectId || "").trim();
    if (!pid) {
        window.location.href = "./projects.html";
        return;
    }
    window.location.href = `./${page}?project=${encodeURIComponent(pid)}`;
}

function setSidebarAccess(role, memberRole = "") {
    const r = String(role || "").trim().toLowerCase();
    const projectRole = String(memberRole || "").trim().toLowerCase();
    const canEditProject = r === "admin" || ["admin", "editor"].includes(projectRole);

    const canSeeUpdate = canEditProject;
    const canSeeProjectSettings = canEditProject;
    const canSeeAdmin = r === "admin";

    if (navUpdateStatus) {
        navUpdateStatus.style.display = canSeeUpdate ? "flex" : "none";
        navUpdateStatus.classList.toggle("is-hidden", !canSeeUpdate);
    }

    if (navProjectSettings) {
        navProjectSettings.style.display = canSeeProjectSettings ? "flex" : "none";
        navProjectSettings.classList.toggle("is-hidden", !canSeeProjectSettings);
    }

    if (navAdmin) {
        navAdmin.style.display = canSeeAdmin ? "flex" : "none";
        navAdmin.classList.toggle("is-hidden", !canSeeAdmin);
    }
}

async function hydrateUserChip() {
    try {
        const email = __session?.user?.email || __session?.user?.id || "Unknown";

        const { data: prof, error: profErr } = await supabase
            .from("profiles")
            .select("role, display_name")
            .eq("id", __session.user.id)
            .maybeSingle();

        USER_ROLE = (!profErr && prof?.role)
            ? String(prof.role).trim().toLowerCase()
            : "unknown";

        sessionStorage.setItem("user_role", USER_ROLE);
        document.documentElement.setAttribute("data-user-role", USER_ROLE);

        const displayName =
            prof?.display_name ||
            __session?.user?.user_metadata?.display_name ||
            email;

        USER_DISPLAY_NAME = displayName;

        if (userChip) {
            userChip.textContent = `${displayName} (${USER_ROLE})`;
        }

        setSidebarAccess(USER_ROLE);

    } catch (e) {
        console.error("[dashboard] hydrateUserChip failed:", e);
        USER_ROLE = "unknown";
        sessionStorage.setItem("user_role", USER_ROLE);
        document.documentElement.setAttribute("data-user-role", USER_ROLE);
        if (userChip) userChip.textContent = "User";
    }
}

logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem("selected_project_id");
    window.location.replace("./index.html");
});

await hydrateUserChip();

/* ---------- Project resolution ---------- */
async function resolveProjectForUser(userId) {
    const { data: mem, error } = await supabase
        .from("project_members")
        .select("project_id, role, projects(name)")
        .eq("user_id", userId);

    if (error) throw error;

    if (!mem || mem.length === 0) {
        window.location.replace("./projects.html");
        return null;
    }

    const url = new URL(window.location.href);
    const projectParam = url.searchParams.get("project");
    const storedProjectId = sessionStorage.getItem("selected_project_id");

    const wantedProjectId = String(projectParam || storedProjectId || "").trim();

    if (!wantedProjectId) {
        window.location.replace("./projects.html");
        return null;
    }

    const hit = mem.find((m) => String(m.project_id) === wantedProjectId);

    if (!hit) {
        sessionStorage.removeItem("selected_project_id");
        window.location.replace("./projects.html");
        return null;
    }

    sessionStorage.setItem("selected_project_id", String(hit.project_id));

    if (String(projectParam || "") !== String(hit.project_id)) {
        history.replaceState(null, "", `?project=${encodeURIComponent(hit.project_id)}`);
    }

    return {
        project_id: hit.project_id,
        project_name: hit.projects?.name || DEFAULT_PROJECT_NAME,
        member_role: hit.role || "viewer",
    };
}

const PROJECT_CTX = await resolveProjectForUser(__session.user.id);
if (!PROJECT_CTX) throw new Error("Redirecting...");
setSidebarAccess(USER_ROLE, PROJECT_CTX.member_role);
const ticketNavBadge = attachTicketNavBadge({
    supabase,
    navElement: navTickets,
    getProjectId: () => PROJECT_CTX?.project_id || "",
    userId: __session.user.id,
    displayMode: "unread_only",
});
await ticketNavBadge.refresh();

// --- Sync page title from selected project ---
(() => {
    const name = PROJECT_CTX?.project_name || "Project";
    const h1 = document.getElementById("projectTitle");
    if (h1) h1.textContent = name;
    document.title = name;
})();

// --- Sidebar navigation ---
navProjects?.addEventListener("click", () => {
    window.location.href = "./projects.html";
});

navDashboard?.addEventListener("click", () => {
    goProjectPage("dashboard.html", PROJECT_CTX.project_id);
});

navTickets?.addEventListener("click", () => {
    goProjectPage("tickets.html", PROJECT_CTX.project_id);
});

navUpdateStatus?.addEventListener("click", () => {
    goProjectPage("form.html", PROJECT_CTX.project_id);
});

navProjectSettings?.addEventListener("click", () => {
    goProjectPage("project-settings.html", PROJECT_CTX.project_id);
});

navAdmin?.addEventListener("click", () => {
    goProjectPage("admin.html", PROJECT_CTX.project_id);
});

/* ---------- Load from Supabase ---------- */

async function loadFields(projectId) {
    const { data, error } = await supabase
        .from("fields")
        .select("id, key, label, type, options, sort_order, field_role, visible, show_in_dashboard, is_active")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });

    if (error) throw error;

    const byKey = {};
    for (const f of data || []) byKey[f.key] = f;
    return { list: data || [], byKey };
}

async function loadRecords(projectId, includeInactive = false) {
    // Keep this minimal: only select columns that surely exist in `records`
    let q = supabase
        .from("records")
        .select("id, code, title, active, updated_by, created_at, updated_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

    if (!includeInactive) q = q.eq("active", true);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

async function loadRecordValues(recordIds) {
    if (!recordIds || recordIds.length === 0) return [];
    const { data, error } = await supabase
        .from("record_values")
        .select("*")
        .in("record_id", recordIds);

    if (error) throw error;
    return data || [];
}

async function loadBookingValues(recordIds) {
    const byRecordField = new Map();
    if (!recordIds || recordIds.length === 0) return byRecordField;

    const { data, error } = await supabase
        .from("project_availability_bookings")
        .select("id, project_id, slot_id, record_id, field_id, status, booked_at, session_status, session_comment, session_status_submitted_at, session_status_submitted_by_email, project_availability_slots(slot_date, start_time, end_time, timezone, is_active, field_id, consultant_id)")
        .in("record_id", recordIds)
        .eq("status", "booked");

    if (error) {
        console.warn("Booking values unavailable:", error.message || error);
        return byRecordField;
    }

    for (const booking of data || []) {
        const slot = booking.project_availability_slots;
        if (!slot || slot.is_active !== true || String(slot.field_id || "") !== String(booking.field_id || "") || !slot.consultant_id) continue;
        byRecordField.set(bookingMapKey(booking.record_id, booking.field_id), booking);
    }
    return byRecordField;
}


function buildItems(records, recordValues, fieldsById, bookingsByRecordField = new Map()) {
    const byRecord = new Map();
    const fieldsByKey = new Map();
    for (const field of fieldsById.values()) fieldsByKey.set(String(field.key || ""), field);

    for (const rv of recordValues) {
        const rid = rv.record_id;
        const fid = rv.field_id;
        const f = fieldsById.get(fid);
        if (!f) continue;

        const v = pickValueCell(rv);
        if (!byRecord.has(rid)) byRecord.set(rid, {});
        byRecord.get(rid)[f.key] = v;
    }

    const items = [];
    for (const r of records) {
        const vals = byRecord.get(r.id) || {};

        // Build steps
        const step = {};
        const bookings = {};
        const bookingDates = {};
        const bookingSessionStatuses = {};
        const bookingSessionComments = {};
        const stepStatuses = [];
        for (const s of STEP_KEYS) {
            const field = fieldsByKey.get(String(s.key || ""));
            const booking = field && isBookingField(field) ? bookingsByRecordField.get(bookingMapKey(r.id, field.id)) : null;
            const norm = booking ? "Completed" : normalizeStatus(vals[s.key]);
            step[s.key] = norm;
            if (booking) {
                bookings[s.key] = booking;
                bookingDates[s.key] = formatBookingDateTime(booking);
                bookingSessionStatuses[s.key] = formatBookingSessionStatus(booking);
                bookingSessionComments[s.key] = String(booking.session_comment || "");
            }
            stepStatuses.push(norm);
        }

        // Overall is computed by DB (preferred). Fallback to Not Started.
        const overallRaw =
            r.overall_status ??
            r.overall ??
            vals.overall_status ??
            vals.overall ??
            vals.overallStatus ??
            "";

        const overallStatus = normalizeStatus(overallRaw);

        items.push({
            id: r.id,
            code: r.code || "",
            participantName: r.title || "",
            values: vals, // raw values by field key (for dynamic columns)

            // prefer records columns first, fallback to record_values
            email: String((r.email ?? vals.email) ?? ""),
            active: r.active !== false,

            step,
            bookings,
            bookingDates,
            bookingSessionStatuses,
            bookingSessionComments,
            overallStatus,

            // issue/decision now works even if stored in records table
            issue: String((r.issue ?? vals.issue) ?? ""),
            decision: String((r.decision ?? vals.decision) ?? ""),
        });
    }

    return items;
}

/* ---------- Table ---------- */
function syncTopScrollbarWidth() { /* top scrollbar removed — no-op */ }

// Escapes HTML to prevent breaking the DOM when rendering user/data strings.
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Pick the correct value column from record_values row.
function pickValueCell(rv) {
    if (!rv || typeof rv !== "object") return "";

    // Text fields
    if (rv.value_text !== undefined && rv.value_text !== null) return rv.value_text;

    // Select/status fields
    if (rv.value_select !== undefined && rv.value_select !== null) return rv.value_select;

    return "";
}

function normalizeStatus(v) {
    const s = String(v || "").trim();
    if (!s) return "Not Started";
    return STEP_STATUS.includes(s) ? s : "Not Started";
}

function normalizeTicketStatus(value) {
    return String(value || "").trim().toLowerCase() === "done" ? "done" : "open";
}

function getRequestButtonMarkup(item) {
    const stats = TICKET_STATS_BY_RECORD.get(String(item?.id || "")) || { unreadCount: 0, openCount: 0 };
    const unreadCount = Math.max(0, Number(stats.unreadCount || 0));
    const openCount = Math.max(0, Number(stats.openCount || 0));
    const stateClass = unreadCount > 0 ? "has-unread" : openCount > 0 ? "has-open" : "";
    const countMarkup = unreadCount > 0
        ? `<span class="ticket-indicator-badge" aria-label="${unreadCount} unread ticket${unreadCount === 1 ? "" : "s"}">${unreadCount}</span>`
        : openCount > 0
            ? `<span class="ticket-indicator-count" aria-label="${openCount} open ticket${openCount === 1 ? "" : "s"}">${openCount}</span>`
            : "";

    const buttonClass = ["btn-mini", "primary", "js-request", stateClass].filter(Boolean).join(" ");
    return `<button class="${buttonClass}"
            data-id="${escapeHtml(item?.id)}"
            data-code="${escapeHtml(item?.code)}"
            data-name="${escapeHtml(item?.participantName)}"
            data-email="${escapeHtml(item?.email)}">
            <span class="ticket-indicator-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 6h16v12H4z"></path>
                    <path d="m4 7 8 6 8-6"></path>
                </svg>
            </span>
            <span>Request</span>
            ${countMarkup}
        </button>`;
}

function getTicketActivityMeta(ticket, replies) {
    const participants = [];
    const createdAt = Date.parse(ticket?.created_at || "");
    if (Number.isFinite(createdAt)) participants.push({ at: createdAt, actorId: String(ticket?.created_by || "") });

    const repliedAt = Date.parse(ticket?.replied_at || "");
    if (Number.isFinite(repliedAt)) participants.push({ at: repliedAt, actorId: String(ticket?.replied_by || "") });

    for (const reply of replies || []) {
        const at = Date.parse(reply?.created_at || "");
        if (!Number.isFinite(at)) continue;
        participants.push({ at, actorId: String(reply?.author_id || "") });
    }

    if (participants.length === 0) {
        return { lastAt: 0, actorId: "" };
    }

    participants.sort((a, b) => a.at - b.at);
    return participants[participants.length - 1];
}

async function loadTicketStats(projectId) {
    if (!projectId) {
        TICKET_STATS_BY_RECORD = new Map();
        return;
    }

    const { data: tickets, error: ticketsError } = await supabase
        .from("requests")
        .select("id, record_id, status, created_at, created_by, replied_at, replied_by")
        .eq("project_id", projectId);
    if (ticketsError) throw ticketsError;

    const ticketIds = (tickets || []).map((ticket) => ticket.id).filter(Boolean);
    const readStateByTicket = new Map();

    if (ticketIds.length > 0) {
        const { data: readStates, error: readStatesError } = await supabase
            .from("ticket_read_states")
            .select("ticket_id, last_read_at")
            .eq("user_id", __session.user.id)
            .in("ticket_id", ticketIds);
        if (readStatesError) throw readStatesError;

        for (const state of (readStates || [])) {
            readStateByTicket.set(String(state.ticket_id || ""), Date.parse(state.last_read_at || "") || 0);
        }
    }

    const repliesByTicket = new Map();

    if (ticketIds.length > 0) {
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
    }

    const nextStats = new Map();
    for (const ticket of (tickets || [])) {
        const recordId = String(ticket?.record_id || "");
        if (!recordId) continue;

        const current = nextStats.get(recordId) || { unreadCount: 0, openCount: 0 };
        if (normalizeTicketStatus(ticket?.status) === "open") current.openCount += 1;

        const activity = getTicketActivityMeta(ticket, repliesByTicket.get(String(ticket.id || "")));
        const lastReadAt = readStateByTicket.get(String(ticket.id || "")) || 0;
        if (activity.lastAt > lastReadAt && activity.actorId && activity.actorId !== __session.user.id) {
            current.unreadCount += 1;
        }

        nextStats.set(recordId, current);
    }

    TICKET_STATS_BY_RECORD = nextStats;
}

function isEmailShownInDashboard(fieldsList) {
    const emailField = (fieldsList || []).find((f) => {
        const key = String(f?.key || "").toLowerCase();
        const role = String(f?.field_role || "").toLowerCase();
        return key === "email" || role === "email";
    });
    // Keep existing behavior when email field is missing.
    return emailField ? emailField.show_in_dashboard !== false : true;
}

function buildHeaderFromFields(fieldsList) {
    const headRow = document.getElementById("dashboardHeadRow");
    if (!headRow) return;

    headRow.innerHTML = "";
    const showEmailCol = isEmailShownInDashboard(fieldsList);

    // Fixed leading columns: Request | Code | Name | [Email] | Overall Status
    headRow.insertAdjacentHTML("beforeend", `
    <th class="sticky-col sticky-col-0">Request</th>
    <th class="sticky-col sticky-col-1">Code</th>
    <th class="sticky-col sticky-col-2">Participant Name</th>
    ${showEmailCol ? '<th style="min-width:180px;">Email</th>' : ""}
    <th style="min-width:120px;">Overall Status</th>
  `);

    // Dynamic process fields (step columns) — skip fields rendered as fixed columns
    const skip = new Set(["email", "issue", "decision", "overall_status"]);
    for (const f of fieldsList || []) {
        if (skip.has(String(f.key || "").toLowerCase())) continue;
        if (skip.has(String(f.field_role || "").toLowerCase())) continue;
        if (f.show_in_dashboard === false) continue;
        const label = f.label || f.key;
        headRow.insertAdjacentHTML("beforeend", `<th style="min-width:120px;">${escapeHtml(label)}</th>`);
        if (isBookingField(f)) {
            headRow.insertAdjacentHTML("beforeend", `<th style="min-width:160px;">${escapeHtml(label)} Date</th>`);
            headRow.insertAdjacentHTML("beforeend", `<th style="min-width:160px;">${escapeHtml(label)} Session</th>`);
        }
    }

    // Tail: Issue | Decision
    headRow.insertAdjacentHTML("beforeend", `
    <th style="min-width:160px;">Issue</th>
    <th style="min-width:160px;">Decision</th>
  `);

    syncTopScrollbarWidth();
}

// Render a status value as colored text (no pill background).
function statusPill(value, fallback = "Not Started") {
    const s = String(value || "").trim() || fallback;

    let cls = "status-text";
    if (s === "Issue") cls += " status-issue";
    else if (s === "In Progress") cls += " status-inprogress";
    else if (s === "Completed") cls += " status-completed";
    else cls += " status-notstarted";

    return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

// Alias for overall status pill (same styling)
const overallPill = (status) => statusPill(status, "Not Started");

function getDashboardPageCount() {
    return Math.max(1, Math.ceil(dashboardRenderedItems.length / DASHBOARD_PAGE_SIZE));
}

function renderDashboardPager() {
    if (!dashboardPager) return;
    const totalPages = getDashboardPageCount();
    if (dashboardRenderedItems.length <= DASHBOARD_PAGE_SIZE) {
        dashboardPager.hidden = true;
        dashboardPager.innerHTML = "";
        return;
    }

    dashboardPager.hidden = false;
    const start = (dashboardPage - 1) * DASHBOARD_PAGE_SIZE + 1;
    const end = Math.min(dashboardPage * DASHBOARD_PAGE_SIZE, dashboardRenderedItems.length);
    dashboardPager.innerHTML = `
        <button class="table-page-btn" type="button" data-dashboard-page="prev" ${dashboardPage <= 1 ? "disabled" : ""}>Previous</button>
        <span class="table-page-info">Showing ${start}-${end} of ${dashboardRenderedItems.length}</span>
        <button class="table-page-btn" type="button" data-dashboard-page="next" ${dashboardPage >= totalPages ? "disabled" : ""}>Next</button>
    `;
}

function renderTable(items, { resetPage = false } = {}) {
    if (!tbody) return;
    tbody.innerHTML = "";
    dashboardRenderedItems = Array.isArray(items) ? items : [];
    if (resetPage) dashboardPage = 1;
    dashboardPage = Math.min(Math.max(1, dashboardPage), getDashboardPageCount());
    const pageStart = (dashboardPage - 1) * DASHBOARD_PAGE_SIZE;
    const pageItems = dashboardRenderedItems.slice(pageStart, pageStart + DASHBOARD_PAGE_SIZE);
    const showEmailCol = isEmailShownInDashboard(FIELD_CACHE?.list || []);

    for (const it of pageItems) {
        const tr = document.createElement("tr");

        // Request (sticky-0)
        const tdReq = document.createElement("td");
        tdReq.className = "sticky-col sticky-col-0";
        tdReq.innerHTML = getRequestButtonMarkup(it);
        tr.appendChild(tdReq);

        // Code (sticky-1)
        const tdCode = document.createElement("td");
        tdCode.className = "sticky-col sticky-col-1";
        tdCode.textContent = String(it.code || "");
        tr.appendChild(tdCode);

        // Participant Name (sticky-2)
        const tdName = document.createElement("td");
        tdName.className = "sticky-col sticky-col-2";
        tdName.innerHTML = `<b>${escapeHtml(it.participantName || "")}</b>`;
        tr.appendChild(tdName);

        // Email (toggleable from project settings)
        if (showEmailCol) {
            const tdEmail = document.createElement("td");
            tdEmail.textContent = String(it.email || "");
            tr.appendChild(tdEmail);
        }

        // Overall Status (before process cols)
        const tdOverall = document.createElement("td");
        tdOverall.innerHTML = overallPill(it.overallStatus || "Not Started");
        tr.appendChild(tdOverall);

        // Dynamic process columns
        const skip = new Set(["email", "issue", "decision", "overall_status"]);
        for (const f of (FIELD_CACHE?.list || [])) {
            if (skip.has(String(f.key || "").toLowerCase())) continue;
            if (skip.has(String(f.field_role || "").toLowerCase())) continue;
            if (f.show_in_dashboard === false) continue;
            const td = document.createElement("td");
            const raw = it.step?.[f.key] ?? it.values?.[f.key] ?? "";
            td.innerHTML = f.type === "select" ? statusPill(raw || "Not Started") : escapeHtml(String(raw));
            tr.appendChild(td);
            if (isBookingField(f)) {
                const tdDate = document.createElement("td");
                tdDate.textContent = String(it.bookingDates?.[f.key] || "");
                tr.appendChild(tdDate);
                const tdSession = document.createElement("td");
                tdSession.innerHTML = it.bookingSessionStatuses?.[f.key]
                    ? statusPill(it.bookingSessionStatuses[f.key], "")
                    : "";
                if (it.bookingSessionComments?.[f.key]) tdSession.title = it.bookingSessionComments[f.key];
                tr.appendChild(tdSession);
            }
        }

        // Issue
        const tdIssue = document.createElement("td");
        tdIssue.textContent = String(it.issue || "");
        tr.appendChild(tdIssue);

        // Decision
        const tdDecision = document.createElement("td");
        tdDecision.textContent = String(it.decision || "");
        tr.appendChild(tdDecision);

        tbody.appendChild(tr);
    }

    renderDashboardPager();
    syncTopScrollbarWidth();
}

function getVisibleDashboardFields() {
    const fieldsList = FIELD_CACHE?.list || [];
    const showEmailCol = isEmailShownInDashboard(fieldsList);
    const skip = new Set(["email", "issue", "decision", "overall_status"]);

    const columns = [
        { key: "code", label: "Code", getValue: (it) => String(it.code || "") },
        { key: "participantName", label: "Participant Name", getValue: (it) => String(it.participantName || "") },
    ];

    if (showEmailCol) {
        columns.push({
            key: "email",
            label: "Email",
            getValue: (it) => String(it.email || ""),
        });
    }

    columns.push({
        key: "overallStatus",
        label: "Overall Status",
        getValue: (it) => String(it.overallStatus || "Not Started"),
    });

    for (const f of fieldsList) {
        if (skip.has(String(f.key || "").toLowerCase())) continue;
        if (skip.has(String(f.field_role || "").toLowerCase())) continue;
        if (f.show_in_dashboard === false) continue;

        columns.push({
            key: f.key,
            label: f.label || f.key,
            getValue: (it) => String(it.step?.[f.key] ?? it.values?.[f.key] ?? ""),
        });

        if (isBookingField(f)) {
            columns.push({
                key: `${f.key}__booking_date`,
                label: `${f.label || f.key} Date`,
                getValue: (it) => String(it.bookingDates?.[f.key] || ""),
            });
            columns.push({
                key: `${f.key}__session_status`,
                label: `${f.label || f.key} Session`,
                getValue: (it) => String(it.bookingSessionStatuses?.[f.key] || ""),
            });
        }
    }

    columns.push(
        { key: "issue", label: "Issue", getValue: (it) => String(it.issue || "") },
        { key: "decision", label: "Decision", getValue: (it) => String(it.decision || "") },
    );

    return columns;
}

function getFilteredDashboardItems() {
    return applyDashFilter();
}

function getExportRows() {
    const columns = getVisibleDashboardFields();
    const items = getFilteredDashboardItems();
    const rows = items.map((item) => {
        const row = {};
        for (const col of columns) row[col.label] = col.getValue(item);
        return row;
    });
    return { columns, rows, items };
}

function getCurrentExportFilterSummary() {
    const parts = [];
    const search = String(dashSearchInput?.value || "").trim();
    const filterKey = String(dashFilterColumn?.value || "").trim();
    const filterStatus = String(dashFilterStatus?.value || "").trim();

    if (search) parts.push(`Search: ${search}`);

    if (filterKey) {
        const field = (FIELD_CACHE?.list || []).find((f) => String(f.key) === filterKey);
        const label = field?.label || filterKey;
        parts.push(`Filter: ${label}${filterStatus ? ` = ${filterStatus}` : ""}`);
    } else if (filterStatus) {
        parts.push(`Status: ${filterStatus}`);
    }

    return parts.length ? parts.join(" | ") : "No filters applied";
}

function sanitizeFileNamePart(value, fallback) {
    const cleaned = String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return cleaned || fallback;
}

function buildExportFileBaseName() {
    const projectName = sanitizeFileNamePart(PROJECT_CTX?.project_name, "project");
    const datePart = new Date().toISOString().slice(0, 10);
    return `${projectName}-participants-${datePart}`;
}

const XLSX_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js";
let xlsxLoadPromise = null;

function loadXlsxExporter() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;

    xlsxLoadPromise = new Promise((resolve, reject) => {
        const existingScript = [...document.scripts].find((script) => script.src === XLSX_SCRIPT_SRC);
        if (existingScript) {
            existingScript.addEventListener("load", () => resolve(window.XLSX), { once: true });
            existingScript.addEventListener("error", () => reject(new Error("Failed to load XLSX exporter.")), { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = XLSX_SCRIPT_SRC;
        script.async = true;
        script.onload = () => {
            if (window.XLSX) {
                resolve(window.XLSX);
                return;
            }
            xlsxLoadPromise = null;
            reject(new Error("XLSX exporter did not initialize."));
        };
        script.onerror = () => {
            xlsxLoadPromise = null;
            reject(new Error("Failed to load XLSX exporter."));
        };
        document.head.appendChild(script);
    });

    return xlsxLoadPromise;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsvValue(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
    return text;
}

function exportParticipantsCsv() {
    const { columns, items } = getExportRows();
    if (!items.length) {
        alert("No participant rows to export.");
        return;
    }

    const lines = [
        columns.map((col) => toCsvValue(col.label)).join(","),
        ...items.map((item) => columns.map((col) => toCsvValue(col.getValue(item))).join(",")),
    ];

    const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
        type: "text/csv;charset=utf-8;",
    });
    downloadBlob(blob, `${buildExportFileBaseName()}.csv`);
    closeExportMenu();
}

async function exportParticipantsXlsx() {
    const { columns, rows } = getExportRows();
    if (!rows.length) {
        alert("No participant rows to export.");
        return;
    }

    const previousLabel = exportXlsxBtn?.textContent || "Excel (.xlsx)";
    if (exportXlsxBtn) {
        exportXlsxBtn.disabled = true;
        exportXlsxBtn.textContent = "Loading Excel...";
    }

    let XLSX;
    try {
        XLSX = await loadXlsxExporter();
    } catch (error) {
        console.warn("XLSX export unavailable:", error?.message || error);
        alert("XLSX export is unavailable right now. Please try CSV instead.");
        if (exportXlsxBtn) {
            exportXlsxBtn.textContent = previousLabel;
            updateExportButtons();
        }
        return;
    }

    const generatedAt = new Date().toLocaleString();
    const filterSummary = getCurrentExportFilterSummary();
    const headerLabels = columns.map((col) => col.label);
    const dataRows = rows.map((row) => headerLabels.map((label) => row[label] ?? ""));
    const metaRows = [
        [`${PROJECT_CTX?.project_name || "Project"} Participants Export`],
        ["Project", PROJECT_CTX?.project_name || "-"],
        ["Generated At", generatedAt],
        ["Rows", String(rows.length)],
        ["Filters", filterSummary],
        [],
        headerLabels,
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([...metaRows, ...dataRows]);
    const headerRowIndex = metaRows.length - 1;
    const lastColumnIndex = Math.max(headerLabels.length - 1, 0);

    if (headerLabels.length > 0) {
        worksheet["!autofilter"] = {
            ref: XLSX.utils.encode_range({
                s: { r: headerRowIndex, c: 0 },
                e: { r: headerRowIndex + dataRows.length, c: lastColumnIndex },
            }),
        };
        worksheet["!merges"] = [
            {
                s: { r: 0, c: 0 },
                e: { r: 0, c: lastColumnIndex },
            },
        ];
    }

    worksheet["!cols"] = headerLabels.map((label, columnIndex) => {
        const values = [
            label,
            ...dataRows.map((row) => String(row[columnIndex] ?? "")),
        ];
        const maxLength = values.reduce((max, value) => Math.max(max, value.length), 0);
        return { wch: Math.min(Math.max(maxLength + 2, 14), 42) };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");
    XLSX.writeFile(workbook, `${buildExportFileBaseName()}.xlsx`);
    if (exportXlsxBtn) exportXlsxBtn.textContent = previousLabel;
    updateExportButtons();
    closeExportMenu();
}

function closeExportMenu() {
    if (exportMenu) exportMenu.hidden = true;
    if (exportMenuBtn) exportMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleExportMenu() {
    if (!exportMenu || !exportMenuBtn || exportMenuBtn.disabled) return;
    const willOpen = exportMenu.hidden;
    exportMenu.hidden = !willOpen;
    exportMenuBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function updateExportButtons() {
    const hasRows = getFilteredDashboardItems().length > 0;
    if (exportMenuBtn) {
        exportMenuBtn.disabled = !hasRows;
        if (!hasRows) closeExportMenu();
    }
    if (exportCsvBtn) exportCsvBtn.disabled = !hasRows;
    if (exportXlsxBtn) exportXlsxBtn.disabled = !hasRows;
}

/* ---------- Modal (status list) ---------- */
function openStatusModal(status) {
    const label = status === "Total" ? "Total Participants" : status;

    const list =
        status === "Total" ? [...CURRENT_ITEMS] : CURRENT_ITEMS.filter((x) => x.overallStatus === status);

    list.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));

    modalTitle.textContent = `Participants: ${label}`;
    modalSub.textContent = `Rows: ${list.length}`;
    modalTbody.innerHTML = "";

    if (list.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="6" style="color:#6b7280;">No participants found.</td>`;
        modalTbody.appendChild(tr);
    } else {
        for (const it of list) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${escapeHtml(it.code)}</td>
        <td><b>${escapeHtml(it.participantName)}</b></td>
        <td class="issue-cell">${escapeHtml(it.issue)}</td>
        <td class="issue-cell">${escapeHtml(it.decision)}</td>
        <td>
          ${getRequestButtonMarkup(it)}
        </td>
      `;
            modalTbody.appendChild(tr);
        }
    }

    statusModal.classList.add("open");
    statusModal.setAttribute("aria-hidden", "false");
}

function closeStatusModal() {
    statusModal.classList.remove("open");
    statusModal.setAttribute("aria-hidden", "true");
}

function openStatusModalFromChart(chart, event) {
    if (!chart || typeof chart.getElementsAtEventForMode !== "function") return;
    const points = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true);
    if (!Array.isArray(points) || points.length === 0) return;

    const point = points[0];
    const label = chart.data?.labels?.[point.index];
    if (!label) return;

    openStatusModal(String(label));
}

async function notifyViaEdge(payload) {
    try {
        const { data, error } = await supabase.functions.invoke("ticket-notify", { body: payload });
        if (error) throw error;
        if (data?.skipped || data?.ok === false) {
            throw new Error(data?.reason || "notification skipped");
        }
        return { ok: true, data };
    } catch (e) {
        console.warn("Email notification failed (non-fatal):", e);
        return { ok: false, error: e };
    }
}

/* ---------- Request modal -> requests table ---------- */
function openRequestModal(ctx) {
    REQ_CONTEXT = ctx;

    reqTitle.textContent = "Request / Comment";
    reqSub.textContent = `${ctx.code} — ${ctx.participantName || "-"}`;

    if (reqTo) {
        reqTo.value = String(ctx.email || "").trim();
        reqTo.readOnly = true;
    }

    reqSubject.value = `[${PROJECT_CTX.project_name}] Request for ${ctx.code}`;
    reqMessage.value = "";
    reqHint.textContent = "";
    REQ_SAVED_TICKET_ID = "";
    reqSendBtn.disabled = false;
    reqSendBtn.textContent = "Send";

    requestModal.classList.add("open");
    requestModal.setAttribute("aria-hidden", "false");
}

function closeRequestModal() {
    requestModal.classList.remove("open");
    requestModal.setAttribute("aria-hidden", "true");
    REQ_CONTEXT = null;
}

async function sendRequestToSupabase() {
    if (!REQ_CONTEXT) return;
    if (REQ_SAVED_TICKET_ID) {
        reqHint.textContent = "This request has already been saved.";
        return;
    }

    const subject = String(reqSubject.value || "").trim();
    const message = String(reqMessage.value || "").trim();

    if (!subject) { reqHint.textContent = "Missing subject."; return; }
    if (!message) { reqHint.textContent = "Please type a message."; return; }

    reqSendBtn.disabled = true;
    reqHint.textContent = "Sending...";

    let saved = false;
    try {
        const ticketId = createClientUuid();

        const payload = {
            id: ticketId,
            project_id: PROJECT_CTX.project_id,
            record_id: REQ_CONTEXT.recordId,
            code: REQ_CONTEXT.code,
            participant_name: REQ_CONTEXT.participantName,
            subject,
            message,
            created_by: __session.user.id,
        };

        const { error } = await supabase
            .from("requests")
            .insert(payload);
        if (error) throw error;
        saved = true;
        REQ_SAVED_TICKET_ID = ticketId;
        reqSendBtn.textContent = "Saved";

        await loadTicketStats(PROJECT_CTX.project_id);
        renderFilteredDashboardTable();

        const notifyResult = await notifyViaEdge({
            ticketId,
            eventId: ticketId,
            eventType: "new_ticket",
            authorId: __session.user.id,
            authorName: USER_DISPLAY_NAME || __session.user.email || "",
            authorRole: USER_ROLE,
            message: message,
            ticketSubject: subject,
            participantName: REQ_CONTEXT.participantName || "",
            projectName: PROJECT_CTX.project_name || "",
            projectId: PROJECT_CTX.project_id || "",
        });
        if (!notifyResult.ok) {
            reqHint.textContent = "Saved, but email notification failed. Please check notification settings.";
        } else {
            reqHint.textContent = "Sent.";
            setTimeout(() => closeRequestModal(), 450);
        }
    } catch (e) {
        console.error(e);
        reqHint.textContent = "Failed: requests table not found or permission denied (check RLS/policy).";
    } finally {
        if (!saved) reqSendBtn.disabled = false;
    }
}

function createClientUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

// Update KPI chips from loaded items.
// Each item should have `overall` or `overall_status` already computed by DB.
function updateChip(items) {
    const list = Array.isArray(items) ? items : [];

    const getOverall = (it) =>
        String(it?.overall_status ?? it?.overall ?? it?.overallStatus ?? "").trim();

    const norm = (v) => {
        const s = String(v || "").trim();
        if (!s) return "Not Started";
        // Accept the 4 main statuses used in the UI
        if (s === "Issue" || s === "In Progress" || s === "Completed" || s === "Not Started") return s;
        return "Not Started";
    };

    const counts = {
        Total: list.length,
        Completed: 0,
        "In Progress": 0,
        Issue: 0,
        "Not Started": 0,
    };

    for (const it of list) {
        const st = norm(getOverall(it));
        if (counts[st] !== undefined) counts[st] += 1;
    }

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };

    setText("kpiTotal", counts.Total);
    setText("kpiCompleted", counts.Completed);
    setText("kpiInProgress", counts["In Progress"]);
    setText("kpiIssue", counts.Issue);
    setText("kpiNotStarted", counts["Not Started"]);
}

function updateCharts(items) {
    const list = Array.isArray(items) ? items : [];

    const pie = window.__overallPieChart;
    const stacked = window.__processStackedChart;
    if (!pie && !stacked) return;

    // Use consistent colors across KPI / Pie / Bar
    // Slightly stronger colors for charts
    const COLORS = {
        Completed: "#a8ffb5",     // green
        "In Progress": "#a8cfff", // blue
        Issue: "#ffa8a8",         // red
        "Not Started": "#fffba8", // amber
    };

    // Normalize overall status
    const getOverall = (it) =>
        String(it?.overall_status ?? it?.overall ?? it?.overallStatus ?? "").trim();

    const normOverall = (v) => {
        const s = String(v || "").trim();
        if (!s) return "Not Started";
        if (s === "Issue" || s === "In Progress" || s === "Completed" || s === "Not Started") return s;
        return "Not Started";
    };

    // ---------- PIE: Overall Status ----------
    const overallCounts = {
        Completed: 0,
        "In Progress": 0,
        Issue: 0,
        "Not Started": 0,
    };

    for (const it of list) {
        const st = normOverall(getOverall(it));
        overallCounts[st] += 1;
    }

    if (pie) {
        const labels = ["Completed", "In Progress", "Issue", "Not Started"];
        pie.data.labels = labels;
        pie.data.datasets[0].data = labels.map((k) => overallCounts[k]);
        pie.data.datasets[0].backgroundColor = labels.map((k) => COLORS[k]);
        pie.data.datasets[0].borderColor = "#ffffff";
        pie.data.datasets[0].borderWidth = 2;
        pie.update();
    }

    // ---------- STACKED BAR: Status by Process ----------
    // Uses each item.step[stepKey] (already built by buildItems)
    if (stacked) {
        const stepLabels = STEP_KEYS.map((s) => s.label);
        const stepKeys = STEP_KEYS.map((s) => s.key);

        const byStep = {};
        for (const k of stepKeys) {
            byStep[k] = {
                Completed: 0,
                "In Progress": 0,
                Issue: 0,
                "Not Started": 0,
            };
        }

        for (const it of list) {
            const stepObj = it?.step || {};
            for (const k of stepKeys) {
                const st = normalizeStatus(stepObj[k]);
                byStep[k][st] += 1;
            }
        }

        const labels = ["Completed", "In Progress", "Issue", "Not Started"];

        stacked.data.labels = stepLabels;

        // Ensure datasets order matches labels
        stacked.data.datasets = labels.map((status) => ({
            label: status,
            data: stepKeys.map((k) => byStep[k][status]),
            stack: "stack1",
            backgroundColor: COLORS[status],
            borderColor: "#ffffff",
            borderWidth: 1,
        }));

        stacked.update();
    }
}

/* ---------- Dashboard filter ---------- */
function buildDashFilterControls() {
    if (!dashFilterColumn) return;
    dashFilterColumn.innerHTML = "";

    const addOpt = (sel, v, t) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
    };

    addOpt(dashFilterColumn, "", "No column filter");
    for (const s of STEP_KEYS) addOpt(dashFilterColumn, s.key, s.label);

    rebuildDashStatusOptions();
}

function rebuildDashStatusOptions() {
    if (!dashFilterStatus) return;
    dashFilterStatus.innerHTML = "";

    const addOpt = (v, t) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        dashFilterStatus.appendChild(o);
    };

    addOpt("", "All");
    const col = dashFilterColumn?.value || "";
    if (!col) return;

    const field = FIELD_CACHE?.list?.find(f => f.key === col);
    const opts = (field && Array.isArray(field.options) && field.options.length)
        ? field.options
        : STEP_STATUS;
    for (const s of opts) addOpt(s, s);
}

function applyDashFilter() {
    const q = String(dashSearchInput?.value || "").trim().toLowerCase();
    const col = dashFilterColumn?.value || "";
    const st = dashFilterStatus?.value || "";

    return CURRENT_ITEMS.filter(it => {
        if (q && !`${it.code} ${it.participantName} ${it.email}`.toLowerCase().includes(q)) return false;
        if (col && st) {
            const field = FIELD_CACHE?.list?.find(f => f.key === col);
            let val = it.step?.[col] ?? it.values?.[col] ?? "";
            // For select fields, normalize empty → "Not Started" so participants
            // with no saved data still match the "Not Started" filter.
            if (field?.type === "select") val = normalizeStatus(val);
            if (val !== st) return false;
        }
        return true;
    });
}

function renderFilteredDashboardTable(options = {}) {
    renderTable(applyDashFilter(), options);
}

/* ---------- Refresh flow ---------- */
let FIELD_CACHE = null;

async function refresh() {
    try {
        const includeInactive = false;

        const fields = await loadFields(PROJECT_CTX.project_id);
        FIELD_CACHE = fields;
        buildHeaderFromFields(fields.list);

        // use project-specific steps for charts/overall
        // rule: fields.type === 'select' are treated as process steps
        const skipRoles = new Set(["email", "issue", "decision", "overall_status"]);
        STEP_KEYS.length = 0;
        for (const f of (fields.list || [])) {
            if (String(f.type || "").toLowerCase() !== "select") continue;
            if (f.show_in_dashboard === false) continue;
            if (skipRoles.has(String(f.key || "").toLowerCase())) continue;
            if (skipRoles.has(String(f.field_role || "").toLowerCase())) continue;
            STEP_KEYS.push({ key: f.key, label: f.label || f.key });
        }

        const fieldsById = new Map();
        for (const f of fields.list) fieldsById.set(f.id, f);

        const records = await loadRecords(PROJECT_CTX.project_id, includeInactive);
        const rids = records.map((r) => r.id);

        const recordValues = await loadRecordValues(rids);
        const bookingsByRecordField = await loadBookingValues(rids);
        const items = buildItems(records, recordValues, fieldsById, bookingsByRecordField);
        CURRENT_ITEMS = items;
        await loadTicketStats(PROJECT_CTX.project_id);

        buildDashFilterControls();

        updateChip(items);
        updateCharts(items);
        renderFilteredDashboardTable({ resetPage: true });
        updateExportButtons();

        if (lastRefresh) lastRefresh.textContent = new Date().toLocaleString();
    } catch (err) {
        console.error(err);
        alert("Failed to load from Supabase. Check Console (RLS/Policies/Table names).");
    } finally {
        hidePageSkeleton();
    }
}

/* ---------- Events ---------- */
refreshBtn?.addEventListener("click", refresh);

dashSearchInput?.addEventListener("input", () => renderFilteredDashboardTable({ resetPage: true }));
dashSearchInput?.addEventListener("input", updateExportButtons);
dashFilterColumn?.addEventListener("change", () => { rebuildDashStatusOptions(); renderFilteredDashboardTable({ resetPage: true }); });
dashFilterColumn?.addEventListener("change", updateExportButtons);
dashFilterStatus?.addEventListener("change", () => renderFilteredDashboardTable({ resetPage: true }));
dashFilterStatus?.addEventListener("change", updateExportButtons);
exportCsvBtn?.addEventListener("click", exportParticipantsCsv);
exportXlsxBtn?.addEventListener("click", exportParticipantsXlsx);
exportMenuBtn?.addEventListener("click", toggleExportMenu);
dashboardPager?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-dashboard-page]");
    if (!button) return;
    const direction = button.getAttribute("data-dashboard-page");
    const pageCount = getDashboardPageCount();
    if (direction === "prev") dashboardPage = Math.max(1, dashboardPage - 1);
    if (direction === "next") dashboardPage = Math.min(pageCount, dashboardPage + 1);
    renderTable(dashboardRenderedItems);
});

document.addEventListener("click", (e) => {
    if (!exportMenu || exportMenu.hidden) return;
    const target = e.target;
    if (target instanceof Element && (exportMenu.contains(target) || exportMenuBtn?.contains(target))) return;
    closeExportMenu();
});

autoRefresh?.addEventListener("change", () => setAutoRefresh(Number(autoRefresh.value)));

statusModal?.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".js-request");
    if (!btn) return;
    openRequestModal({
        recordId: btn.getAttribute("data-id") || "",
        code: btn.getAttribute("data-code") || "",
        participantName: btn.getAttribute("data-name") || "",
        email: btn.getAttribute("data-email") || "",
    });
});

tbody?.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".js-request");
    if (!btn) return;
    openRequestModal({
        recordId: btn.getAttribute("data-id") || "",
        code: btn.getAttribute("data-code") || "",
        participantName: btn.getAttribute("data-name") || "",
        email: btn.getAttribute("data-email") || "",
    });
});

reqCancelBtn?.addEventListener("click", closeRequestModal);
requestModal?.addEventListener("click", (e) => {
    if (e.target === requestModal) closeRequestModal();
});
reqSendBtn?.addEventListener("click", sendRequestToSupabase);

modalCloseBtn2?.addEventListener("click", closeStatusModal);
statusModal?.addEventListener("click", (e) => {
    if (e.target === statusModal) closeStatusModal();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeExportMenu();
        closeStatusModal();
        closeRequestModal();
    }
});

kpiCards.forEach((node) => {
    node.addEventListener("click", () => {
        const status = node.getAttribute("data-status") || "Total";
        openStatusModal(status);
    });
});

/* ---------- Auto refresh ---------- */
let timer = null;
function setAutoRefresh(seconds) {
    if (timer) clearInterval(timer);
    timer = null;
    if (!seconds || seconds <= 0) return;
    timer = setInterval(refresh, seconds * 1000);
}

function formatPercent(value, total) {
    if (!total) return "0%";
    return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function formatCountFraction(value, total) {
    return `${Number(value || 0)}/${Number(total || 0)}`;
}

function formatCountPercent(value, total) {
    return `${formatCountFraction(value, total)} (${formatPercent(value, total)})`;
}

function getDatasetTotal(values) {
    return (Array.isArray(values) ? values : []).reduce((sum, value) => sum + Number(value || 0), 0);
}

function ensureChartPercentagePlugin() {
    if (window.__dashboardPercentPluginReady || typeof Chart === "undefined") return;

    Chart.register({
        id: "dashboardPercentLabels",
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            if (!ctx) return;

            ctx.save();
            ctx.font = "600 11px system-ui";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (chart.config.type === "doughnut") {
                const dataset = chart.data.datasets?.[0];
                const meta = chart.getDatasetMeta(0);
                const total = getDatasetTotal(dataset?.data);
                if (!dataset || !meta || !total) {
                    ctx.restore();
                    return;
                }

                meta.data.forEach((arc, index) => {
                    const value = Number(dataset.data[index] || 0);
                    if (!value) return;

                    const angle = (arc.startAngle + arc.endAngle) / 2;
                    const radius = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.62;
                    const x = arc.x + Math.cos(angle) * radius;
                    const y = arc.y + Math.sin(angle) * radius;

                    ctx.fillStyle = "#1f2937";
                    ctx.fillText(formatCountPercent(value, total), x, y);
                });
            }

            if (chart.config.type === "bar" && chart.options?.indexAxis === "y") {
                const labels = chart.data.labels || [];
                const totalsByRow = labels.map((_, rowIndex) =>
                    chart.data.datasets.reduce((sum, dataset) => sum + Number(dataset?.data?.[rowIndex] || 0), 0)
                );

                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((bar, rowIndex) => {
                        const value = Number(dataset?.data?.[rowIndex] || 0);
                        const total = totalsByRow[rowIndex];
                        if (!value || !total) return;

                        const width = Math.abs(bar.base - bar.x);
                        if (width < 34) return;

                        ctx.fillStyle = "#1f2937";
                        ctx.fillText(formatCountFraction(value, total), (bar.base + bar.x) / 2, bar.y);
                    });
                });
            }

            ctx.restore();
        },
    });

    window.__dashboardPercentPluginReady = true;
}

function initCharts() {
    // Ensure canvases exist
    const pieCanvas = document.getElementById("overallPie");
    const barCanvas = document.getElementById("processStacked");
    if (!pieCanvas || !barCanvas) return;

    // Avoid re-creating charts
    if (window.__overallPieChart && window.__processStackedChart) return;

    if (typeof Chart === "undefined") {
        console.warn("[dashboard] Chart.js is not loaded");
        return;
    }

    ensureChartPercentagePlugin();

    // Donut (Overall Status)
    window.__overallPieChart = new Chart(pieCanvas.getContext("2d"), {
        type: "doughnut",
        data: {
            labels: ["Completed", "In Progress", "Issue", "Not Started"],
            datasets: [{ data: [0, 0, 0, 0] }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "58%",
            onClick(event, elements, chart) {
                if (!elements?.length) return;
                openStatusModalFromChart(chart, event);
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        padding: 10,
                        font: { size: 11.5 },
                    },
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const dataset = context.dataset?.data || [];
                            const total = getDatasetTotal(dataset);
                            const value = Number(context.raw || 0);
                            return `${context.label}: ${formatCountPercent(value, total)}`;
                        },
                    },
                },
            },
        },
    });

    // Stacked Bar (Status by Process)
    window.__processStackedChart = new Chart(barCanvas.getContext("2d"), {
        type: "bar",
        data: {
            labels: [], // step labels will be filled later
            datasets: [
                { label: "Completed", data: [], stack: "stack1" },
                { label: "In Progress", data: [], stack: "stack1" },
                { label: "Issue", data: [], stack: "stack1" },
                { label: "Not Started", data: [], stack: "stack1" },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: {
                legend: { position: "bottom" },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const rowIndex = context.dataIndex;
                            const total = context.chart.data.datasets.reduce(
                                (sum, dataset) => sum + Number(dataset?.data?.[rowIndex] || 0),
                                0
                            );
                            const value = Number(context.raw || 0);
                            return `${context.dataset.label}: ${formatCountPercent(value, total)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: "Number of Participants",
                        color: "#64748b",
                        font: { size: 12, weight: "600" },
                    },
                    ticks: { precision: 0 },
                },
                y: { stacked: true },
            },
        },
    });
}

/* init (safe) */
function safeInitCharts() {
    if (typeof initCharts !== "function") {
        console.warn("[dashboard] initCharts is missing - skip charts for now");
        return;
    }
    try {
        initCharts();
    } catch (e) {
        console.warn("[dashboard] initCharts failed - skip charts for now", e);
    }
}

window.addEventListener("load", () => {
    safeInitCharts();
});

window.addEventListener("resize", () => syncTopScrollbarWidth());

/* ---------- View tabs (Overview / Participants) ---------- */
function initTabs() {
    const tabs = document.querySelectorAll(".view-tab");
    const viewOverview   = document.getElementById("viewOverview");
    const viewParticipants = document.getElementById("viewParticipants");

    // Restore last active tab from session
    const saved = sessionStorage.getItem("dashboard_tab") || "overview";
    applyTab(saved);

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => applyTab(tab.dataset.tab));
    });

    function applyTab(name) {
        tabs.forEach((t) => {
            const isActive = t.dataset.tab === name;
            t.classList.toggle("active", isActive);
            t.setAttribute("aria-selected", String(isActive));
        });

        if (viewOverview)   viewOverview.style.display   = name === "overview"   ? "" : "none";
        if (viewParticipants) viewParticipants.style.display = name === "participants" ? "" : "none";

        // Toggle flex-chain that makes each tab fit the viewport
        document.body.classList.toggle("overview-active",    name === "overview");
        document.body.classList.toggle("participants-active",  name === "participants");

        sessionStorage.setItem("dashboard_tab", name);

        // Let the browser apply the new layout, then replay entry animation
        if (name === "overview") {
            requestAnimationFrame(() => {
                const pie = window.__overallPieChart;
                const bar = window.__processStackedChart;
                if (pie) { pie.resize(); pie.reset(); pie.update(); }
                if (bar) { bar.resize(); bar.reset(); bar.update(); }
            });
        }
    }
}

initTabs();

setAutoRefresh(Number(autoRefresh?.value || 0));
safeInitCharts();
await refresh();
