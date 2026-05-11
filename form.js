import { supabase } from "./supabaseClient.js";
import { STEP_STATUS, normalizeStatus, computeOverall } from "./lib/form-utils.js";
import { attachTicketNavBadge } from "./lib/ticket-nav-badge.js";
import { bookingMapKey, formatBookingDateTime, isBookingField } from "./lib/booking-utils.js";

const UUID_PAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserNames(userIds) {
    const ids = [...new Set((userIds || []).filter(id => id && UUID_PAT.test(String(id))))];
    if (ids.length === 0) return new Map();
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
    const map = new Map();
    for (const p of (data || [])) map.set(p.id, p.display_name || p.id);
    return map;
}

/* ============================
   FORM (Supabase) - Dynamic Fields
   - Internal / admin only
   - Fields loaded from DB (type="select" -> dynamic steps)
   - issue / decision are system text fields, required when any step = "Issue"
   ============================ */

/* ---------- Config ---------- */
const DEFAULT_PROJECT_NAME  = "Project ABC";
// STEP_STATUS, normalizeStatus, computeOverall imported from ./lib/form-utils.js
const TABLE_SAVE_DEBOUNCE_MS = 900;

/* ---------- UI refs ---------- */
const el = (id) => document.getElementById(id);

const saveState       = el("saveState");
const lastSync        = el("lastSync");
const reloadBtn       = el("reloadBtn");
const saveTopBtn      = el("saveTopBtn");
const newParticipantBtn = el("newParticipantBtn");

const searchInput  = el("searchInput");
const filterColumn = el("filterColumn");
const filterStatus = el("filterStatus");
const showInactive = el("showInactive");
const addRowBtn    = el("addRowBtn");
const addParticipantModal = el("addParticipantModal");
const addParticipantCloseBtn = el("addParticipantCloseBtn");
const addParticipantCancelBtn = el("addParticipantCancelBtn");
const addParticipantSubmitBtn = el("addParticipantSubmitBtn");
const addCandCode = el("addCandCode");
const addCandName = el("addCandName");
const addCandEmail = el("addCandEmail");
const addCandError = el("addCandError");

const tbody           = el("tbody");
const tableWrap       = el("tableWrap");
const grid            = el("grid");
const hscrollTop      = el("hscrollTop");
const hscrollTopInner = el("hscrollTopInner");

const candPick      = el("candPick");
const participantList = el("participantList");
const candCode      = el("candCode");
const candName      = el("candName");
const candEmail     = el("candEmail");
const candUpdatedBy = el("candUpdatedBy");
const candIssue     = el("candIssue");
const candDecision  = el("candDecision");

const loadHint     = el("loadHint");
const emailHint    = el("emailHint");
const issueHint    = el("issueHint");
const decisionHint = el("decisionHint");

/* ---------- AUTH GUARD ---------- */
async function requireInternalAccess() {
    const { data } = await supabase.auth.getSession();
    const session  = data?.session;
    if (!session) { window.location.replace("./index.html"); return null; }

    supabase.auth.onAuthStateChange((_event, s) => {
        if (!s) window.location.replace("./index.html");
    });

    const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, display_name")
        .eq("id", session.user.id)
        .maybeSingle();

    const role = (!error && profile?.role) ? String(profile.role) : "external";

    if (role === "participant" || role === "external") {
        window.location.replace("./participant-status.html");
        return null;
    }

    return { session, role, displayName: profile?.display_name || "" };
}

const __auth = await requireInternalAccess();
if (!__auth) throw new Error("No access");

const SESSION      = __auth.session;
const PROFILE_ROLE = String(__auth.role || "").trim().toLowerCase();
const currentUserName = () => __auth.displayName || SESSION?.user?.email || "";
const currentUserId = () => SESSION?.user?.id || null;

(function setUserChip() {
    const chip = document.getElementById("userChip");
    if (!chip) return;
    const name = __auth.displayName || SESSION?.user?.email || "User";
    chip.textContent = `${name} (${PROFILE_ROLE})`;
})();

sessionStorage.setItem("user_role", PROFILE_ROLE);
document.documentElement.setAttribute("data-user-role", PROFILE_ROLE);

(function applySidebarAccess() {
    const isAdmin    = PROFILE_ROLE === "admin";
    const isInternal = PROFILE_ROLE === "internal";
    const navUpdate  = document.getElementById("navUpdateStatus");
    const navAdmin   = document.getElementById("navAdmin");
    if (navUpdate) navUpdate.style.display = isAdmin || isInternal ? "" : "none";
    if (navAdmin)  navAdmin.style.display  = isAdmin ? "" : "none";
})();

/* ---------- Helpers ---------- */
function nowStamp() { return new Date().toLocaleString(); }

function statusClassSuffix(v) {
    const s = String(v || "").trim();
    if (s === "Completed") return "status-completed";
    if (s === "In Progress") return "status-in-progress";
    if (s === "Issue") return "status-issue";
    return "status-not-started";
}

function setSavePill(state, text) {
    if (!saveState) return;
    saveState.className  = "save-pill " + state;
    saveState.textContent = text;
}

function setLoadHintVisible(on) {
    if (loadHint) loadHint.style.display = on ? "block" : "none";
}

function validateEmail(v) {
    const s = String(v || "").trim();
    if (!s) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function setHint(el, visible) { if (el) el.style.display = visible ? "block" : "none"; }
const setEmailHint    = (v) => setHint(emailHint, v);
const setIssueHint    = (v) => setHint(issueHint, v);
const setDecisionHint = (v) => setHint(decisionHint, v);

/** First valid option for a field, falls back to STEP_STATUS[0] */
function getDefaultOption(field) {
    return (Array.isArray(field?.options) && field.options.length)
        ? field.options[0]
        : (STEP_STATUS[0] ?? "Not Started");
}

function pickValueCell(rv) {
    if (!rv || typeof rv !== "object") return "";
    if (rv.value_text   != null) return rv.value_text;
    if (rv.value_select != null) return rv.value_select;
    return "";
}

function recomputeOverall(row) {
    const statuses = SELECT_FIELDS.map(f => normalizeStatus(row.steps[f.key], f.options));
    row.overall    = computeOverall(statuses);
    // DB trigger handles persisting overall_status when step values are saved
}

/* ---------- Required-field validation ---------- */
function hasAnyIssue(row) {
    return SELECT_FIELDS.some(f => row.steps[f.key] === "Issue");
}

/**
 * Returns true when form can be saved.
 * Also updates hint visibility as a side-effect.
 */
function validateRequiredFields(row) {
    if (!hasAnyIssue(row)) {
        setIssueHint(false);
        setDecisionHint(false);
        return true;
    }
    const issueMissing    = ISSUE_FIELD    && !String(row.issue    || "").trim();
    const decisionMissing = DECISION_FIELD && !String(row.decision || "").trim();
    setIssueHint(!!issueMissing);
    setDecisionHint(!!decisionMissing);
    return !issueMissing && !decisionMissing;
}

/* ---------- Project resolution ---------- */
async function resolveProjectForUser(userId) {
    const { data: mem, error } = await supabase
        .from("project_members")
        .select("project_id, role, projects(name)")
        .eq("user_id", userId);

    if (error) throw error;
    if (!mem || mem.length === 0) throw new Error("No project membership found.");

    const url           = new URL(window.location.href);
    const projectParam  = url.searchParams.get("project");
    const storedProjectId = sessionStorage.getItem("selected_project_id");
    const wantedId      = String(projectParam || storedProjectId || "").trim();

    if (wantedId) {
        const hit = mem.find(m => String(m.project_id) === wantedId);
        if (hit) {
            sessionStorage.setItem("selected_project_id", String(hit.project_id));
            return {
                project_id:   hit.project_id,
                project_name: hit.projects?.name || DEFAULT_PROJECT_NAME,
                member_role:  hit.role || "editor",
            };
        }
    }

    const preferred = mem[0];
    return {
        project_id:   preferred.project_id,
        project_name: preferred.projects?.name || DEFAULT_PROJECT_NAME,
        member_role:  preferred.role || "editor",
    };
}

const PROJECT_CTX = await resolveProjectForUser(SESSION.user.id);
const ticketNavBadge = attachTicketNavBadge({
    supabase,
    navElement: document.getElementById("navTickets"),
    getProjectId: () => PROJECT_CTX?.project_id || sessionStorage.getItem("selected_project_id") || "",
    userId: SESSION.user.id,
    displayMode: "unread_only",
});
await ticketNavBadge.refresh();

/* ---------- Sidebar wiring ---------- */
(function wireSidebarLinks() {
    if (!PROJECT_CTX?.project_id) return;
    sessionStorage.setItem("selected_project_id", String(PROJECT_CTX.project_id));
    const pid = encodeURIComponent(PROJECT_CTX.project_id);

    const wire = (id, url) => {
        const a = document.getElementById(id);
        if (!a) return;
        a.setAttribute("href", url);
        a.addEventListener("click", e => { e.preventDefault(); window.location.href = url; });
    };

    wire("navDashboard",    `./dashboard.html?project=${pid}`);
    wire("navTickets",      `./tickets.html?project=${pid}`);
    wire("navUpdateStatus", `./form.html?project=${pid}`);
    wire("navAdmin",        `./admin.html?project=${pid}`);

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
        await supabase.auth.signOut();
        sessionStorage.removeItem("selected_project_id");
        window.location.replace("./index.html");
    });
})();

// Page title
(() => {
    const name = PROJECT_CTX?.project_name || "Project";
    const h1   = document.getElementById("formTitle");
    if (h1) h1.textContent = `Update Participant Status - ${name}`;
    document.title = `Update Participant - ${name}`;
})();

/* ============================================================
   STATE
   ============================================================ */
let FIELDS    = { list: [], byKey: {}, byId: new Map() };
let MODEL     = [];
let SELECTED  = null;
let BOOKINGS_BY_RECORD_FIELD = new Map();

/* Derived from FIELDS after each reload */
let SELECT_FIELDS        = [];   // fields with type="select" excluding overall_status
let OVERALL_STATUS_FIELD = null; // overall_status field (read-only, DB-computed)
let ISSUE_FIELD          = null; // field with key="issue"
let DECISION_FIELD       = null; // field with key="decision"
let STEP_SELECTS         = [];   // [{ field, select }] - top-form dynamic selects
let overallStatusDisplay = null; // DOM element showing overall status in top form

let GLOBAL_IN_FLIGHT = 0;
let LAST_SAVE_OK     = true;
let SORT_STATE       = { key: "", dir: 0 };
let UID_SEQ          = 1;
let LAST_ADDED_UID   = null;
let TOP_FORM_LOCK    = false;
let ROW_ELEMENTS     = new Map();

/* ============================================================
   FETCH
   ============================================================ */
async function loadFields(projectId) {
    let { data, error } = await supabase
        .from("fields")
        .select("id, key, label, type, options, sort_order, field_role, is_active, show_in_internal")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });

    if (error && String(error.message || "").includes("show_in_internal")) {
        ({ data, error } = await supabase
            .from("fields")
            .select("id, key, label, type, options, sort_order, field_role, is_active")
            .eq("project_id", projectId)
            .order("sort_order", { ascending: true }));
        data = (data || []).map((field) => ({
            ...field,
            show_in_internal: field.is_active !== false,
        }));
    }

    if (error) throw error;

    const byKey = {};
    const byId  = new Map();
    for (const f of data || []) {
        byKey[f.key] = f;
        byId.set(f.id, f);
    }
    return { list: data || [], byKey, byId };
}

async function loadRecords(projectId, includeInactive = false) {
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
        .select("id, project_id, slot_id, record_id, field_id, status, booked_at, project_availability_slots(slot_date, start_time, end_time, timezone)")
        .in("record_id", recordIds)
        .eq("status", "booked");

    if (error) {
        console.warn("Booking values unavailable:", error.message || error);
        return byRecordField;
    }

    for (const booking of data || []) {
        byRecordField.set(bookingMapKey(booking.record_id, booking.field_id), booking);
    }
    return byRecordField;
}

/* ============================================================
   BUILD MODEL
   ============================================================ */
function buildModel(records, recordValues, bookingsByRecordField = new Map()) {
    const byRecord = new Map();
    for (const rv of recordValues) {
        const field = FIELDS.byId.get(rv.field_id);
        if (!field) continue;
        if (!byRecord.has(rv.record_id)) byRecord.set(rv.record_id, {});
        byRecord.get(rv.record_id)[field.key] = pickValueCell(rv);
    }

    return records.map(r => {
        const vals = byRecord.get(r.id) || {};
        const row  = {
            _uid:         "r_" + UID_SEQ++,
            _dirty:       {},
            _timer:       null,
            _saving:      false,
            _needsResave: false,
            _failCount:   0,
            id:        r.id,
            code:      r.code    || "",
            name:      r.title   || "",
            email:     String(vals.email    ?? ""),
            updatedBy: r.updated_by || "",
            active:    r.active !== false,
            steps:     {},
            bookings:  {},
            bookingDates: {},
            _bookingStatusNeedsSync: {},
            issue:     String(vals.issue    ?? ""),
            decision:  String(vals.decision ?? ""),
            overall:   String(vals.overall_status ?? "").trim(),
        };

        for (const f of SELECT_FIELDS) {
            const booking = isBookingField(f) ? bookingsByRecordField.get(bookingMapKey(r.id, f.id)) : null;
            if (booking) {
                row.bookings[f.key] = booking;
                row.bookingDates[f.key] = formatBookingDateTime(booking);
                row.steps[f.key] = "Completed";
                if (normalizeStatus(vals[f.key], f.options) !== "Completed") {
                    row._bookingStatusNeedsSync[f.key] = true;
                }
            } else {
                row.steps[f.key] = normalizeStatus(vals[f.key], f.options);
            }
        }

        if (!row.overall) {
            const statuses = SELECT_FIELDS.map(f => normalizeStatus(row.steps[f.key], f.options));
            row.overall    = computeOverall(statuses);
        }

        return row;
    });
}

/* ============================================================
   SAVE HELPERS
   ============================================================ */
function markDirty(row, key, value) { row._dirty[key] = value; }

function setGlobalSaveState() {
    if (GLOBAL_IN_FLIGHT > 0) { setSavePill("save-saving", "Saving..."); return; }
    setSavePill(LAST_SAVE_OK ? "save-saved" : "save-failed",
                LAST_SAVE_OK ? "Saved" : "Failed (not saved)");
}

async function upsertRecordValue(recordId, fieldKey, value) {
    const field = FIELDS.byKey[fieldKey];
    if (!field) throw new Error(`Field key not found: ${fieldKey}`);

    const v          = value == null ? "" : String(value);
    const t          = String(field.type || "").toLowerCase();
    const isTextLike = ["text", "textarea", "email", "string", "note"].includes(t);

    const { error } = await supabase
        .from("record_values")
        .upsert({
            record_id:    recordId,
            field_id:     field.id,
            value_select: isTextLike ? null : v,
            value_text:   isTextLike ? v    : null,
        }, { onConflict: "record_id,field_id" });

    if (error) throw error;
}

async function syncBookedStepStatuses(rows) {
    const jobs = [];
    for (const row of rows || []) {
        for (const key of Object.keys(row._bookingStatusNeedsSync || {})) {
            jobs.push(upsertRecordValue(row.id, key, "Completed"));
        }
    }
    if (jobs.length) await Promise.all(jobs);
}

async function updateRecordBase(row) {
    const userId = currentUserId();
    if (!userId) throw new Error("Missing session user id");

    const { error } = await supabase
        .from("records")
        .update({ title: row.name, updated_by: userId, updated_at: new Date().toISOString() })
        .eq("id", row.id);
    if (error) throw error;
}

async function saveRowNow(row) {
    if (!row?.id) return;
    if (!Object.keys(row._dirty).length) return;
    if (row._saving) { row._needsResave = true; return; }

    // Stop retrying after 3 consecutive failures to prevent infinite loops
    if ((row._failCount || 0) >= 3) return;

    const snapshot = { ...row._dirty };
    if (snapshot.email !== undefined && !validateEmail(snapshot.email)) delete snapshot.email;

    row._saving = true;
    GLOBAL_IN_FLIGHT++;
    setGlobalSaveState();

    try {
        const baseKeys = ["name"]; // "email" is stored in record_values via upsertRecordValue
        await updateRecordBase(row); // always captures updated_by + updated_at
        row.updatedBy = currentUserName();

        for (const k of Object.keys(snapshot).filter(k => !baseKeys.includes(k))) {
            await upsertRecordValue(row.id, k, snapshot[k]);
        }

        LAST_SAVE_OK = true;
        row._failCount = 0;
        for (const k of Object.keys(snapshot)) delete row._dirty[k];
        const tr = ROW_ELEMENTS.get(row._uid);
        if (tr) updateRowCells(tr, row);
    } catch (e) {
        row._failCount = (row._failCount || 0) + 1;
        console.error("Save failed (attempt", row._failCount, "):", e?.message || e?.code || e);
        LAST_SAVE_OK = false;
        setSavePill("save-failed", row._failCount >= 3
            ? "Save failed - reload page to retry"
            : "Failed (check RLS/policies/schema)");
    } finally {
        GLOBAL_IN_FLIGHT = Math.max(0, GLOBAL_IN_FLIGHT - 1);
        row._saving = false;
        setGlobalSaveState();
        if (row._needsResave || Object.keys(row._dirty).length) {
            row._needsResave = false;
            saveRowNow(row).catch(() => { });
        }
    }
}

function scheduleRowSave(row) {
    if (row._timer) clearTimeout(row._timer);
    row._timer = setTimeout(() => saveRowNow(row).catch(() => { }), TABLE_SAVE_DEBOUNCE_MS);
}

/* ============================================================
   PARTICIPANT PICKER
   ============================================================ */
function enableDatalistOpenOnFocus(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener("focus", () => {
        if (!inputEl.value) return;
        inputEl.dataset.prevValue = inputEl.value;
        inputEl.value = "";
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    inputEl.addEventListener("blur", () => {
        if (!inputEl.value && inputEl.dataset.prevValue) inputEl.value = inputEl.dataset.prevValue;
        delete inputEl.dataset.prevValue;
    });
}
enableDatalistOpenOnFocus(candPick);

function buildParticipantPicker() {
    if (!participantList) return;
    participantList.innerHTML = "";
    for (const r of MODEL) {
        if (!String(r.code || "").trim()) continue;
        const opt   = document.createElement("option");
        opt.value   = `${r.code} | ${r.name || ""}`.trim();
        participantList.appendChild(opt);
    }
}

function buildParticipantPickerFiltered(queryLower) {
    if (!participantList) return;
    const q = String(queryLower || "").trim();
    participantList.innerHTML = "";
    for (const r of MODEL) {
        if (!String(r.code || "").trim()) continue;
        const hay = `${r.code} ${r.name || ""} ${r.email || ""}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        const opt = document.createElement("option");
        opt.value = `${r.code} | ${r.name || ""}`.trim();
        participantList.appendChild(opt);
    }
}

function parseCodeFromPick(text) {
    return String(text || "").trim().split(" | ")[0].trim();
}

/* ============================================================
   TOP FORM - DYNAMIC STEP SELECTS
   ============================================================ */

/** Rebuild the steps-grid UI from SELECT_FIELDS. Call after each field reload. */
function buildStepSelectsUI() {
    const stepsGrid = el("stepsGrid");
    if (!stepsGrid) return;
    stepsGrid.innerHTML = "";
    STEP_SELECTS = [];

    for (const f of SELECT_FIELDS) {
        const wrapper = document.createElement("div");

        const lbl       = document.createElement("label");
        lbl.className   = "label";
        lbl.textContent = f.label;

        const sel       = document.createElement("select");
        sel.className   = "select";
        sel.dataset.fieldKey = f.key;

        const opts = (Array.isArray(f.options) && f.options.length) ? f.options : STEP_STATUS;
        for (const opt of opts) {
            const o       = document.createElement("option");
            o.value       = opt;
            o.textContent = opt;
            sel.appendChild(o);
        }

        wrapper.appendChild(lbl);
        wrapper.appendChild(sel);

        let bookingDateDisplay = null;
        if (isBookingField(f)) {
            bookingDateDisplay = document.createElement("div");
            bookingDateDisplay.className = "booking-date-inline";
            wrapper.appendChild(bookingDateDisplay);
        }

        stepsGrid.appendChild(wrapper);
        STEP_SELECTS.push({ field: f, select: sel, bookingDateDisplay });
    }

    // Overall Status - read-only, computed by DB
    if (OVERALL_STATUS_FIELD) {
        const wrapper = document.createElement("div");
        const lbl = document.createElement("label");
        lbl.className   = "label";
        lbl.textContent = "Overall Status";
        overallStatusDisplay = document.createElement("div");
        overallStatusDisplay.className = "overall-status-badge";
        overallStatusDisplay.textContent = "-";
        wrapper.appendChild(lbl);
        wrapper.appendChild(overallStatusDisplay);
        stepsGrid.appendChild(wrapper);
    }
}

/** Rebind change events on step selects (call after buildStepSelectsUI). */
function bindTopFormStepEvents() {
    for (const { field, select } of STEP_SELECTS) {
        select.addEventListener("change", () => {
            if (TOP_FORM_LOCK || !SELECTED) return;
            if (SELECTED.bookings?.[field.key]) {
                select.value = "Completed";
                return;
            }
            SELECTED.steps[field.key] = select.value;
            markDirty(SELECTED, field.key, select.value);
            recomputeOverall(SELECTED);
            if (overallStatusDisplay) {
                const v = SELECTED.overall || "Not Started";
                overallStatusDisplay.textContent = v;
                overallStatusDisplay.className = "overall-status-badge overall-" + v.toLowerCase().replace(/\s+/g, "-");
            }
            validateRequiredFields(SELECTED);
            renderTable();
        });
    }
}

function updateTopFormFromRow(row) {
    if (!row) return;
    TOP_FORM_LOCK = true;

    candPick.value      = row.code ? `${row.code} | ${row.name || ""}`.trim() : "";
    candCode.value      = row.code      || "";
    candName.value      = row.name      || "";
    candEmail.value     = row.email     || "";
    if (candUpdatedBy) { candUpdatedBy.value = row.updatedBy || ""; candUpdatedBy.readOnly = true; }
    candIssue.value     = row.issue     || "";
    candDecision.value  = row.decision  || "";

    for (const { field, select, bookingDateDisplay } of STEP_SELECTS) {
        const hasBooking = !!row.bookings?.[field.key];
        if (hasBooking && ![...select.options].some((option) => option.value === "Completed")) {
            const completed = document.createElement("option");
            completed.value = "Completed";
            completed.textContent = "Completed";
            select.appendChild(completed);
        }
        select.value = hasBooking ? "Completed" : (row.steps[field.key] ?? getDefaultOption(field));
        select.disabled = hasBooking;
        select.classList.toggle("booking-locked", hasBooking);
        if (bookingDateDisplay) {
            bookingDateDisplay.textContent = hasBooking ? `Booked: ${row.bookingDates?.[field.key] || "-"}` : "";
        }
    }

    if (overallStatusDisplay) {
        const v = row.overall || "Not Started";
        overallStatusDisplay.textContent = v;
        overallStatusDisplay.className = "overall-status-badge overall-" +
            v.toLowerCase().replace(/\s+/g, "-");
    }

    if (candCode)  { candCode.readOnly  = true; candCode.disabled  = true; }
    if (candName)  { candName.readOnly  = true; }
    if (candEmail) { candEmail.readOnly = true; }

    setIssueHint(false);
    setDecisionHint(false);

    TOP_FORM_LOCK = false;
}

function setSelectedRowByCode(code) {
    const c   = String(code || "").trim();
    const row = MODEL.find(r => String(r.code || "").trim() === c);
    if (!row) return;
    SELECTED = row;
    updateTopFormFromRow(row);
}

/** Bind events for static top-form fields (runs once at boot). */
function bindTopFormEvents() {
    candPick?.addEventListener("change", () => {
        setSelectedRowByCode(parseCodeFromPick(candPick.value));
    });

    if (candCode) { candCode.readOnly = true; candCode.disabled = true; }

    const updateLocal = (key, getFn) => () => {
        if (TOP_FORM_LOCK || !SELECTED) return;
        const v = getFn();
        if (key === "name")      SELECTED.name      = v;
        if (key === "email")     SELECTED.email     = v;
        if (key === "issue")     { SELECTED.issue    = v; validateRequiredFields(SELECTED); }
        if (key === "decision")  { SELECTED.decision = v; validateRequiredFields(SELECTED); }
        markDirty(SELECTED, key, v);
        renderTable();
        buildParticipantPicker();
    };

    candIssue?.addEventListener("blur",    updateLocal("issue",    () => candIssue.value));
    candDecision?.addEventListener("blur", updateLocal("decision", () => candDecision.value));
}

/* ============================================================
   TABLE - DYNAMIC HEADER
   ============================================================ */
function renderTableHead() {
    const thead = el("thead");
    if (!thead) return;

    const tr = document.createElement("tr");

    function makeSortTh(key, label, minWidth, extraClass) {
        const th  = document.createElement("th");
        if (minWidth)   th.style.minWidth = minWidth;
        if (extraClass) th.className      = extraClass;

        const btn       = document.createElement("button");
        btn.className   = "th-btn sort-btn";
        btn.type        = "button";
        btn.dataset.key = key;

        const textSpan       = document.createElement("span");
        textSpan.className   = "th-text";
        textSpan.textContent = label;

        const sortSpan             = document.createElement("span");
        sortSpan.className         = "th-sort";
        sortSpan.dataset.sortIcon  = key;
        sortSpan.textContent       = "-";

        btn.appendChild(textSpan);
        btn.appendChild(sortSpan);
        th.appendChild(btn);
        return th;
    }

    // Fixed columns
    tr.appendChild(makeSortTh("code",  "Code",           null,    "sticky-col sticky-col-1 sticky-th"));
    tr.appendChild(makeSortTh("name",  "Participant Name", null,    "sticky-col sticky-col-2 sticky-th"));
    tr.appendChild(makeSortTh("email", "Email",          "240px", null));

    // Dynamic select columns (from DB)
    for (const f of SELECT_FIELDS) {
        tr.appendChild(makeSortTh(f.key, f.label, null, null));
        if (isBookingField(f)) {
            tr.appendChild(makeSortTh(`${f.key}__booking_date`, `${f.label} Date`, "180px", null));
        }
    }

    // Overall Status (read-only, DB-computed)
    if (OVERALL_STATUS_FIELD) {
        const th = document.createElement("th");
        th.style.minWidth = "140px";
        const span = document.createElement("span");
        span.className = "th-text plain-th";
        span.textContent = "Overall Status";
        th.appendChild(span);
        tr.appendChild(th);
    }

    // System text columns
    tr.appendChild(makeSortTh("issue",     "Issue",           "220px", null));
    tr.appendChild(makeSortTh("decision",  "Decision",        "220px", null));
    tr.appendChild(makeSortTh("updatedBy", "Last Updated By", "160px", null));
    tr.appendChild(makeSortTh("active",    "Active",          "140px", null));

    // Actions (no sort)
    const thAct       = document.createElement("th");
    thAct.style.minWidth = "160px";
    const actSpan     = document.createElement("span");
    actSpan.className = "th-text plain-th";
    actSpan.textContent = "Actions";
    thAct.appendChild(actSpan);
    tr.appendChild(thAct);

    thead.innerHTML = "";
    thead.appendChild(tr);
}

/* ============================================================
   FILTERS + SORT
   ============================================================ */
function buildFilterControls() {
    if (!filterColumn || !filterStatus) return;
    filterColumn.innerHTML = "";

    const cols = [
        { value: "",       label: "No column filter" },
        ...SELECT_FIELDS.map(f => ({ value: f.key, label: f.label })),
        { value: "active", label: "Active" },
    ];

    for (const c of cols) {
        const opt       = document.createElement("option");
        opt.value       = c.value;
        opt.textContent = c.label;
        filterColumn.appendChild(opt);
    }

    rebuildStatusOptions();
}

function rebuildStatusOptions() {
    if (!filterStatus || !filterColumn) return;
    filterStatus.innerHTML = "";

    const col    = filterColumn.value;
    const addOpt = (v, t) => {
        const o       = document.createElement("option");
        o.value       = v;
        o.textContent = t;
        filterStatus.appendChild(o);
    };

    addOpt("", "All");
    if (!col) return;

    if (col === "active") { addOpt("true", "Active"); addOpt("false", "Inactive"); return; }

    const f    = SELECT_FIELDS.find(f => f.key === col);
    const opts = (f && Array.isArray(f.options) && f.options.length) ? f.options : STEP_STATUS;
    for (const s of opts) addOpt(s, s);
}

function getSortValue(row, key) {
    if (!key)              return "";
    if (key === "code")      return row.code      || "";
    if (key === "name")      return row.name      || "";
    if (key === "email")     return row.email     || "";
    if (key === "issue")     return row.issue     || "";
    if (key === "decision")  return row.decision  || "";
    if (key === "updatedBy") return row.updatedBy || "";
    if (key === "active")    return row.active ? "Active" : "Inactive";
    if (key.endsWith("__booking_date")) {
        const stepKey = key.replace(/__booking_date$/, "");
        return row.bookingDates?.[stepKey] || "";
    }

    const f = SELECT_FIELDS.find(f => f.key === key);
    if (f) return row.steps[key] || getDefaultOption(f);
    return "";
}

function applySort(rows) {
    if (!SORT_STATE.key || SORT_STATE.dir === 0) return rows;
    const dir = SORT_STATE.dir;
    return [...rows].sort((a, b) => {
        const as = String(getSortValue(a, SORT_STATE.key) ?? "");
        const bs = String(getSortValue(b, SORT_STATE.key) ?? "");
        return dir * as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
    });
}

function setSortIcon(key, dir) {
    document.querySelectorAll("[data-sort-icon]").forEach(node => {
        const k          = node.getAttribute("data-sort-icon");
        node.textContent = (k === key && dir !== 0) ? (dir === 1 ? "^" : "v") : "-";
        node.style.opacity = (k === key && dir !== 0) ? "1" : "0.75";
    });
}

function bindSortButtons() {
    document.querySelectorAll(".sort-btn").forEach(b => {
        b.addEventListener("click", () => {
            const key = b.getAttribute("data-key") || "";
            if (SORT_STATE.key !== key) SORT_STATE = { key, dir: 1 };
            else SORT_STATE.dir = SORT_STATE.dir === 0 ? 1 : SORT_STATE.dir === 1 ? -1 : 0;
            setSortIcon(SORT_STATE.key, SORT_STATE.dir);
            renderTable();
        });
    });
    setSortIcon(SORT_STATE.key, SORT_STATE.dir);
}

function currentFilteredModel() {
    const q         = String(searchInput?.value || "").trim().toLowerCase();
    const col       = filterColumn?.value || "";
    const st        = filterStatus?.value || "";
    const showInact = !!showInactive?.checked;

    let rows = MODEL.filter(r => {
        if (!showInact && !r.active) return false;
        if (q) {
            if (!`${r.code} ${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
        }
        if (col) {
            if (col === "active") {
                const want = st === "" ? null : st === "true";
                if (want !== null && r.active !== want) return false;
            } else {
                const f   = SELECT_FIELDS.find(f => f.key === col);
                const val = r.steps[col] || getDefaultOption(f);
                if (st && val !== st) return false;
            }
        }
        return true;
    });

    return applySort(rows);
}

/* ============================================================
   TABLE - CELL BUILDERS
   ============================================================ */
function makeSelect(field, statusValue, onChange) {
    const sel  = document.createElement("select");
    sel.className = "cell-select";
    const opts = [...((Array.isArray(field.options) && field.options.length) ? field.options : STEP_STATUS)];
    if (statusValue && !opts.includes(statusValue)) opts.push(statusValue);
    for (const s of opts) {
        const o       = document.createElement("option");
        o.value       = s;
        o.textContent = s;
        sel.appendChild(o);
    }
    sel.value = statusValue;
    sel.addEventListener("change", onChange);
    return sel;
}

function makeInput(value, onInput, { readOnly = false, bold = false } = {}) {
    const inp     = document.createElement("input");
    inp.className = "cell-input" + (readOnly ? " cell-readonly" : "");
    inp.value     = value ?? "";
    inp.readOnly  = !!readOnly;
    if (bold) inp.style.fontWeight = "950";
    inp.addEventListener("input", onInput);
    return inp;
}

function makeTextarea(value, onInput) {
    const ta     = document.createElement("textarea");
    ta.className = "cell-textarea";
    ta.value     = value ?? "";
    ta.addEventListener("input", onInput);
    return ta;
}

function makeTextCell(value, { bold = false, key = "" } = {}) {
    const span = document.createElement("span");
    span.className = "cell-text" + (bold ? " cell-text-bold" : "");
    span.textContent = value ?? "";
    if (key) span.dataset.cellKey = key;
    return span;
}

function activePill(active) {
    const span       = document.createElement("span");
    span.className   = "status-text " + (active ? "active-text" : "inactive-text");
    span.textContent = active ? "Active" : "Inactive";
    return span;
}

function scrollToRowUid(uid) {
    if (!uid) return;
    const tr = tbody?.querySelector?.(`tr[data-uid="${CSS.escape(uid)}"]`);
    if (!tableWrap || !tr) return;
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
    tr.querySelector("td select.cell-select, td input.cell-input")?.focus();
}

/* ============================================================
   TABLE - ROW BUILD / UPDATE
   ============================================================ */
function buildRow(r) {
    const tr    = document.createElement("tr");
    tr.dataset.uid = r._uid;

    // Code (readonly)
    const tdCode = document.createElement("td");
    tdCode.className = "sticky-col sticky-col-1";
    tdCode.appendChild(makeTextCell(r.code || "", { bold: true, key: "code" }));
    tr.appendChild(tdCode);

    // Name (display)
    const tdName  = document.createElement("td");
    tdName.className = "sticky-col sticky-col-2";
    tdName.appendChild(makeTextCell(r.name || "", { bold: true, key: "name" }));
    tr.appendChild(tdName);

    // Email (display)
    const tdEmail  = document.createElement("td");
    tdEmail.appendChild(makeTextCell(r.email || "", { key: "email" }));
    tr.appendChild(tdEmail);

    // Dynamic select fields
    for (const f of SELECT_FIELDS) {
        const td  = document.createElement("td");
        const hasBooking = !!r.bookings?.[f.key];
        const sel = makeSelect(f, r.steps[f.key], () => {
            if (r.bookings?.[f.key]) {
                sel.value = "Completed";
                return;
            }
            r.steps[f.key] = sel.value;
            sel.classList.remove("status-not-started", "status-in-progress", "status-completed", "status-issue");
            sel.classList.add(statusClassSuffix(sel.value));
            markDirty(r, f.key, r.steps[f.key]);
            recomputeOverall(r);
            scheduleRowSave(r);
        });
        sel.classList.add(statusClassSuffix(r.steps[f.key]));
        if (hasBooking) {
            sel.disabled = true;
            sel.classList.add("booking-locked");
            sel.title = "Booking date exists; status is completed.";
        }
        sel.dataset.cellKey = f.key;
        td.appendChild(sel);
        tr.appendChild(td);

        if (isBookingField(f)) {
            const tdDate = document.createElement("td");
            tdDate.appendChild(makeTextCell(r.bookingDates?.[f.key] || "", { key: `${f.key}__booking_date` }));
            tdDate.querySelector("[data-cell-key]")?.classList.add("booking-date-cell");
            tr.appendChild(tdDate);
        }
    }

    // Overall Status (read-only, DB-computed)
    if (OVERALL_STATUS_FIELD) {
        const tdOverall = document.createElement("td");
        const spanOverall = document.createElement("span");
        const v = r.overall || "Not Started";
        spanOverall.className = "status-text " + statusClassSuffix(v);
        spanOverall.textContent = v;
        spanOverall.dataset.cellKey = "overall_status";
        tdOverall.appendChild(spanOverall);
        tr.appendChild(tdOverall);
    }

    // Issue
    const tdIssue  = document.createElement("td");
    const inpIssue  = makeInput(r.issue || "", () => {
        r.issue = inpIssue.value;
        markDirty(r, "issue", r.issue);
        scheduleRowSave(r);
    });
    inpIssue.dataset.cellKey = "issue";
    tdIssue.appendChild(inpIssue);
    tr.appendChild(tdIssue);

    // Decision
    const tdDecision  = document.createElement("td");
    const inpDecision  = makeInput(r.decision || "", () => {
        r.decision = inpDecision.value;
        markDirty(r, "decision", r.decision);
        scheduleRowSave(r);
    });
    inpDecision.dataset.cellKey = "decision";
    tdDecision.appendChild(inpDecision);
    tr.appendChild(tdDecision);

    // Updated By (read-only - auto-set from session on save)
    const tdUpd = document.createElement("td");
    tdUpd.appendChild(makeTextCell(r.updatedBy || "-", { key: "updatedBy" }));
    tr.appendChild(tdUpd);

    // Active
    const tdActive = document.createElement("td");
    const aPill = activePill(r.active);
    aPill.dataset.cellKey = "active";
    tdActive.appendChild(aPill);
    tr.appendChild(tdActive);

    // Actions
    const tdAct  = document.createElement("td");
    const wrap   = document.createElement("div");
    wrap.className = "row-actions";

    const btnToggle       = document.createElement("button");
    btnToggle.className   = "mini-btn " + (r.active ? "mini-btn-danger" : "mini-btn-ok");
    btnToggle.textContent = r.active ? "Deactivate" : "Reactivate";

    btnToggle.addEventListener("click", async () => {
        const prev = r.active;
        r.active   = !r.active;

        try {
            GLOBAL_IN_FLIGHT++;
            setGlobalSaveState();
            const { error } = await supabase
                .from("records")
                .update({ active: r.active, updated_at: new Date().toISOString(), updated_by: currentUserId() })
                .eq("id", r.id);
            if (error) throw error;
            LAST_SAVE_OK = true;
            renderTable();
        } catch (e) {
            console.error(e);
            LAST_SAVE_OK = false;
            setSavePill("save-failed", "Failed (check RLS/policies)");
            r.active = prev;
        } finally {
            GLOBAL_IN_FLIGHT = Math.max(0, GLOBAL_IN_FLIGHT - 1);
            setGlobalSaveState();
            await reloadAll().catch(() => { });
        }
    });

    wrap.appendChild(btnToggle);
    tdAct.appendChild(wrap);
    tr.appendChild(tdAct);

    tr.addEventListener("click", ev => {
        if (["input", "select", "textarea", "button"].includes(ev.target?.tagName?.toLowerCase())) return;
        SELECTED = r;
        updateTopFormFromRow(r);
    });

    return tr;
}

function updateRowCells(tr, r) {
    const focused = document.activeElement;
    for (const cell of tr.querySelectorAll("[data-cell-key]")) {
        if (cell === focused) continue;
        const key    = cell.dataset.cellKey;
        if (key.endsWith("__booking_date")) {
            const stepKey = key.replace(/__booking_date$/, "");
            cell.textContent = r.bookingDates?.[stepKey] || "";
            cell.classList.add("booking-date-cell");
            continue;
        }
        const newVal =
            key === "code"      ? r.code      :
            key === "name"      ? r.name      :
            key === "email"     ? r.email     :
            key === "issue"     ? r.issue     :
            key === "decision"  ? r.decision  :
            key === "updatedBy" ? r.updatedBy :
            r.steps[key];                      // dynamic select

        if (key === "overall_status") {
            const v = r.overall || "Not Started";
            cell.textContent = v;
            cell.className = "status-text " + statusClassSuffix(v);
            continue;
        }
        if (key === "updatedBy") {
            cell.textContent = r.updatedBy || "-";
            continue;
        }
        if (key === "active") {
            cell.className   = "status-text " + (r.active ? "active-text" : "inactive-text");
            cell.textContent = r.active ? "Active" : "Inactive";
            continue;
        }
        if (cell.tagName === "SELECT") {
            if (newVal !== undefined && cell.value !== String(newVal)) cell.value = newVal;
            cell.classList.remove("status-not-started", "status-in-progress", "status-completed", "status-issue");
            cell.classList.add(statusClassSuffix(cell.value));
            const hasBooking = !!r.bookings?.[key];
            cell.disabled = hasBooking;
            cell.classList.toggle("booking-locked", hasBooking);
            continue;
        }
        if (cell.tagName === "INPUT" || cell.tagName === "TEXTAREA") {
            if (newVal !== undefined && cell.value !== String(newVal)) cell.value = newVal;
            continue;
        }
        if (newVal !== undefined) cell.textContent = String(newVal);
    }

    const toggleBtn = tr.querySelector(".mini-btn");
    if (toggleBtn) {
        toggleBtn.className   = "mini-btn " + (r.active ? "mini-btn-danger" : "mini-btn-ok");
        toggleBtn.textContent = r.active ? "Deactivate" : "Reactivate";
    }
}

function renderTable() {
    const rows = currentFilteredModel();
    if (!tbody) return;

    const newUidSet = new Set(rows.map(r => r._uid));
    for (const [uid, tr] of ROW_ELEMENTS) {
        if (!newUidSet.has(uid)) { tr.remove(); ROW_ELEMENTS.delete(uid); }
    }

    for (let i = 0; i < rows.length; i++) {
        const r  = rows[i];
        let   tr = ROW_ELEMENTS.get(r._uid);
        if (tr) {
            updateRowCells(tr, r);
        } else {
            tr = buildRow(r);
            ROW_ELEMENTS.set(r._uid, tr);
        }
        if (tbody.children[i] !== tr) tbody.insertBefore(tr, tbody.children[i] || null);
    }

    if (lastSync) lastSync.textContent = nowStamp();
    if (LAST_ADDED_UID) {
        const uid = LAST_ADDED_UID;
        LAST_ADDED_UID = null;
        setTimeout(() => scrollToRowUid(uid), 0);
    }
    syncHorizontalScrollbars();
}

/* ============================================================
   HORIZONTAL SCROLL SYNC
   ============================================================ */
let SCROLL_SYNC_LOCK = false;

function syncHorizontalScrollbars() {
    if (!grid || !tableWrap || !hscrollTopInner || !hscrollTop) return;
    hscrollTopInner.style.width = grid.scrollWidth + "px";
    if (!SCROLL_SYNC_LOCK) hscrollTop.scrollLeft = tableWrap.scrollLeft;
}

function bindHorizontalScrollSync() {
    if (!tableWrap || !hscrollTop) return;
    tableWrap.addEventListener("scroll", () => {
        if (SCROLL_SYNC_LOCK) return;
        SCROLL_SYNC_LOCK = true;
        hscrollTop.scrollLeft = tableWrap.scrollLeft;
        SCROLL_SYNC_LOCK = false;
    });
    hscrollTop.addEventListener("scroll", () => {
        if (SCROLL_SYNC_LOCK) return;
        SCROLL_SYNC_LOCK = true;
        tableWrap.scrollLeft = hscrollTop.scrollLeft;
        SCROLL_SYNC_LOCK = false;
    });
    window.addEventListener("resize", syncHorizontalScrollbars);
}

/* ============================================================
   ACTIONS
   ============================================================ */
async function createNewParticipant(seed = {}) {
    try {
        setSavePill("save-saving", "Creating new participant...");
        const nextCode = String(seed.code || "").trim();
        const nextName = String(seed.name || "").trim();
        const nextEmail = String(seed.email || "").trim();

        const { data, error } = await supabase
            .from("records")
            .insert({
                project_id: PROJECT_CTX.project_id,
                code: nextCode,
                title: nextName,
                active: true,
                updated_by: currentUserId()
            })
            .select("id, code, title, active, updated_by, created_at, updated_at")
            .single();
        if (error) throw error;

        const defOpt = getDefaultOption(null);
        const row    = {
            _uid: "r_" + UID_SEQ++, _dirty: {}, _timer: null, _saving: false, _needsResave: false, _failCount: 0,
            id: data.id, code: data.code || "(new)", name: nextName, email: nextEmail, updatedBy: currentUserName(),
            active: true, steps: {}, issue: "", decision: "", overall: defOpt,
        };

        for (const f of SELECT_FIELDS) {
            row.steps[f.key] = getDefaultOption(f);
            await upsertRecordValue(row.id, f.key, getDefaultOption(f));
        }
        if (nextEmail) await upsertRecordValue(row.id, "email", nextEmail);
        if (ISSUE_FIELD)    await upsertRecordValue(row.id, "issue",    "");
        if (DECISION_FIELD) await upsertRecordValue(row.id, "decision", "");

        MODEL.push(row);
        SELECTED       = row;
        LAST_ADDED_UID = row._uid;
        buildParticipantPicker();
        renderTable();
        if (candPick) updateTopFormFromRow(row);
        setSavePill("save-idle", "Idle");
    } catch (e) {
        console.error(e);
        setSavePill("save-failed", "Create failed (check RLS/policies)");
        throw e;
    }
}

function openAddParticipantModal() {
    if (!addParticipantModal) return;
    if (addCandCode) addCandCode.value = "";
    if (addCandName) addCandName.value = "";
    if (addCandEmail) addCandEmail.value = "";
    if (addCandError) {
        addCandError.style.display = "none";
        addCandError.textContent = "";
    }
    addParticipantModal.classList.add("open");
    addParticipantModal.setAttribute("aria-hidden", "false");
    addCandCode?.focus();
}

function closeAddParticipantModal() {
    if (!addParticipantModal) return;
    addParticipantModal.classList.remove("open");
    addParticipantModal.setAttribute("aria-hidden", "true");
}

async function submitAddParticipantModal() {
    const code = String(addCandCode?.value || "").trim();
    const name = String(addCandName?.value || "").trim();
    const email = String(addCandEmail?.value || "").trim();

    const fail = (msg) => {
        if (addCandError) {
            addCandError.textContent = msg;
            addCandError.style.display = "block";
        }
    };

    if (!code) return fail("Code is required.");
    if (!name) return fail("Participant name is required.");
    if (email && !validateEmail(email)) return fail("Email format is invalid.");

    const dup = MODEL.some(r => String(r.code || "").trim().toLowerCase() === code.toLowerCase());
    if (dup) return fail("This code already exists.");

    try {
        await createNewParticipant({ code, name, email });
        closeAddParticipantModal();
    } catch (e) {
        const msg = String(e?.message || e || "");
        if (msg.toLowerCase().includes("duplicate")) fail("This code already exists.");
        else fail("Create failed. Please check code uniqueness and try again.");
    }
}

/* ============================================================
   RELOAD  (derives SELECT_FIELDS from DB on every load)
   ============================================================ */
async function reloadAll() {
    setSavePill("save-saving", "Loading...");
    setLoadHintVisible(false);

    try {
        FIELDS = await loadFields(PROJECT_CTX.project_id);

        // Derive dynamic field lists from what DB returns
        const isOverall = f => f.key === "overall_status" || f.field_role === "overall_status";
        const internalFields = FIELDS.list.filter(f => f.show_in_internal !== false);
        SELECT_FIELDS        = internalFields.filter(f => f.type === "select" && !isOverall(f));
        OVERALL_STATUS_FIELD = FIELDS.list.find(isOverall) ?? null;
        ISSUE_FIELD          = internalFields.find(f => f.key === "issue")    ?? null;
        DECISION_FIELD       = internalFields.find(f => f.key === "decision") ?? null;

        const includeInactive = !!showInactive?.checked;
        const records = await loadRecords(PROJECT_CTX.project_id, includeInactive);
        const namesMap = await resolveUserNames(records.map(r => r.updated_by));
        for (const r of records) {
            if (namesMap.has(r.updated_by)) r.updated_by = namesMap.get(r.updated_by);
        }
        const values  = await loadRecordValues(records.map(r => r.id));
        BOOKINGS_BY_RECORD_FIELD = await loadBookingValues(records.map(r => r.id));

        MODEL        = buildModel(records, values, BOOKINGS_BY_RECORD_FIELD);
        await syncBookedStepStatuses(MODEL).catch((error) => {
            console.warn("Booked step status sync failed:", error?.message || error);
        });
        ROW_ELEMENTS.clear();
        if (tbody) tbody.innerHTML = "";

        // Rebuild all dynamic UI
        buildStepSelectsUI();
        bindTopFormStepEvents();
        renderTableHead();
        buildParticipantPicker();
        buildFilterControls();
        bindSortButtons();
        buildParticipantPickerFiltered(String(searchInput?.value || "").trim().toLowerCase());

        if (!SELECTED && MODEL.length) {
            SELECTED = MODEL[0];
            updateTopFormFromRow(SELECTED);
        } else if (SELECTED) {
            const fresh = MODEL.find(r => r.id === SELECTED.id);
            if (fresh) SELECTED = fresh;
            if (SELECTED) updateTopFormFromRow(SELECTED);
        }

        setSavePill("save-idle", "Idle");
        renderTable();
    } catch (e) {
        console.error("FORM reloadAll error:", e);
        setSavePill("save-failed", "Failed to load (check RLS/policies/schema)");
        setLoadHintVisible(true);
        SELECT_FIELDS  = [];
        ISSUE_FIELD    = null;
        DECISION_FIELD = null;
        MODEL          = [];
        buildStepSelectsUI();
        renderTableHead();
        buildParticipantPicker();
        buildFilterControls();
        renderTable();
    }
}

/* ============================================================
   WIRE EVENTS
   ============================================================ */
function wireEvents() {
    searchInput?.addEventListener("input", () => {
        buildParticipantPickerFiltered(String(searchInput.value || "").trim().toLowerCase());
        renderTable();
    });
    showInactive?.addEventListener("change", () => reloadAll());
    filterColumn?.addEventListener("change", () => { rebuildStatusOptions(); renderTable(); });
    filterStatus?.addEventListener("change", renderTable);
    reloadBtn?.addEventListener("click",      () => reloadAll());
    addRowBtn?.addEventListener("click",      () => openAddParticipantModal());
    newParticipantBtn?.addEventListener("click",() => openAddParticipantModal());
    addParticipantCloseBtn?.addEventListener("click", () => closeAddParticipantModal());
    addParticipantCancelBtn?.addEventListener("click", () => closeAddParticipantModal());
    addParticipantSubmitBtn?.addEventListener("click", () => submitAddParticipantModal().catch(console.error));
    addParticipantModal?.addEventListener("click", (e) => {
        if (e.target === addParticipantModal) closeAddParticipantModal();
    });
    const submitOnEnter = (e) => {
        if (e.key === "Enter") submitAddParticipantModal().catch(console.error);
    };
    addCandCode?.addEventListener("keydown", submitOnEnter);
    addCandName?.addEventListener("keydown", submitOnEnter);
    addCandEmail?.addEventListener("keydown", submitOnEnter);

    saveTopBtn?.addEventListener("click", async () => {
        if (!SELECTED) return;

        // Validate email
        if (!validateEmail(candEmail?.value ?? "")) {
            setEmailHint(true);
            candEmail?.focus();
            return;
        }
        setEmailHint(false);

        // Pull UI -> model
        SELECTED.name      = candName?.value     ?? "";
        SELECTED.email     = candEmail?.value    ?? "";
        SELECTED.issue     = candIssue?.value    ?? "";
        SELECTED.decision  = candDecision?.value ?? "";

        for (const { field, select } of STEP_SELECTS) {
            SELECTED.steps[field.key] = select.value;
        }
        recomputeOverall(SELECTED);

        // Validate required fields (issue / decision when any step = "Issue")
        if (!validateRequiredFields(SELECTED)) {
            const missingEl = (ISSUE_FIELD && !String(SELECTED.issue || "").trim())
                ? candIssue
                : candDecision;
            missingEl?.focus();
            return;
        }

        // Mark all dirty
        markDirty(SELECTED, "issue",     SELECTED.issue);
        markDirty(SELECTED, "decision",  SELECTED.decision);
        for (const { field } of STEP_SELECTS) {
            markDirty(SELECTED, field.key, SELECTED.steps[field.key] ?? getDefaultOption(field));
        }

        await saveRowNow(SELECTED);
        await reloadAll();
    });
}

/* ============================================================
   BOOT
   ============================================================ */
wireEvents();
bindTopFormEvents();
bindHorizontalScrollSync();
await reloadAll();
