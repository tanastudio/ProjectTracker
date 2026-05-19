import { isBlankCsvRow, normalizeCsvHeader, parseCsvRows } from "../../lib/csv-utils.js";

export function createParticipantImportController(ctx) {
  const { supabase, SUPABASE_URL, el, PROJECT_ID, showHint, clearHint, escapeHtml } = ctx;
  const session = ctx.session;
  const members = ctx.state.members;

  const EDGE_URL = `${SUPABASE_URL}/functions/v1/admin-create-user`;
  let csvRows = [];
  let participantsLoaded = false;
  const PARTICIPANT_PAGE_SIZE = 50;
  let participantRows = [];
  let participantPage = 1;

  function getParticipantPageCount() {
    return Math.max(1, Math.ceil(participantRows.length / PARTICIPANT_PAGE_SIZE));
  }

  function renderParticipantPager() {
    const pager = el("participantPager");
    if (!pager) return;
    const totalPages = getParticipantPageCount();
    if (participantRows.length <= PARTICIPANT_PAGE_SIZE) {
      pager.hidden = true;
      pager.innerHTML = "";
      return;
    }

    pager.hidden = false;
    pager.innerHTML = `
      <button class="participant-page-btn" type="button" data-participant-page="prev" ${participantPage <= 1 ? "disabled" : ""}>Previous</button>
      <span class="participant-page-info">Page ${participantPage} of ${totalPages}</span>
      <button class="participant-page-btn" type="button" data-participant-page="next" ${participantPage >= totalPages ? "disabled" : ""}>Next</button>
    `;
  }

  function renderParticipantRows() {
    const list = el("participantList");
    if (!list) return;

    if (participantRows.length === 0) {
      list.innerHTML = "<div class='muted'>No participants yet.</div>";
      el("participantCount").textContent = "";
      renderParticipantPager();
      return;
    }

    const totalPages = getParticipantPageCount();
    participantPage = Math.min(Math.max(1, participantPage), totalPages);
    const startIndex = (participantPage - 1) * PARTICIPANT_PAGE_SIZE;
    const visibleRows = participantRows.slice(startIndex, startIndex + PARTICIPANT_PAGE_SIZE);

    const rowsHtml = visibleRows.map(c => {
      const name = c.display_name || c.id;
      const email = c.email || c.id;
      const isActive = c.participant_active === true;
      return `
        <div class="participant-row" role="row">
          <div class="participant-role-cell" role="cell">
            <span class="pill pill-participant">participant</span>
          </div>
          <div class="participant-name" role="cell" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="participant-email" role="cell" title="${escapeHtml(email)}">${escapeHtml(email)}</div>
          <div class="participant-status-cell" role="cell">
            <span class="pill ${isActive ? "status-active" : "status-inactive"}">${isActive ? "active" : "inactive"}</span>
          </div>
        </div>`;
    }).join("");

    list.innerHTML = `
      <div class="participant-table-head" role="row">
        <div>Role</div>
        <div>Name</div>
        <div>Email</div>
        <div>Status</div>
      </div>
      ${rowsHtml}
    `;

    const startLabel = startIndex + 1;
    const endLabel = Math.min(startIndex + visibleRows.length, participantRows.length);
    el("participantCount").textContent = `${participantRows.length} participant${participantRows.length !== 1 ? "s" : ""} in this project - showing ${startLabel}-${endLabel}`;
    renderParticipantPager();
  }

  
  async function readHttpErrorMessage(response) {
    try {
      const body = await response.clone().json();
      return body?.error || body?.message || response.statusText || "Unknown import error";
    } catch {
      try {
        return await response.clone().text() || response.statusText || "Unknown import error";
      } catch {
        return response.statusText || "Unknown import error";
      }
    }
  }
  
  function getImportErrorMessage(error) {
    const message = error?.message || String(error || "Unknown import error");
    if (message === "Failed to fetch") {
      return `admin-create-user function is unreachable at ${EDGE_URL}`;
    }
    return message;
  }
  
  async function importParticipant(row, token) {
    const resp = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ email: row.email, display_name: row.name, project_id: PROJECT_ID }),
    });
  
    if (!resp.ok) {
      throw new Error(await readHttpErrorMessage(resp));
    }
  
    const body = await resp.json().catch(() => ({}));
    if (body?.error) {
      throw new Error(body.error);
    }
    return body;
  }
  
  async function loadParticipants() {
    const list = el("participantList");
    list.innerHTML = "<div class='muted'>Loading...</div>";

    let participants = [];
    const { data: rpcRows, error: rpcError } = await supabase.rpc("get_project_members_for_settings", { p_project_id: PROJECT_ID });

    if (!rpcError && Array.isArray(rpcRows)) {
      members.splice(0, members.length, ...rpcRows.map(ctx.controllers.members.normalizeProjectMember));
      participants = members
        .filter((member) => String(member?.profile?.role || "").trim().toLowerCase() === "participant")
        .map((member) => ({
          id: member.user_id,
          display_name: member.profile?.display_name || member.user_id,
          email: member.profile?.email || member.user_id,
          role: "participant",
          participant_record_id: member.profile?.participant_record_id || null,
          participant_active: member.profile?.participant_active,
        }));
    } else {
      if (rpcError) console.warn("Falling back to participant membership query:", rpcError);

      const { data: memberData } = await supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", PROJECT_ID);

      const ids = (memberData || []).map(m => m.user_id);
      if (ids.length === 0) {
        participantRows = [];
        participantPage = 1;
        renderParticipantRows();
        participantsLoaded = true;
        return;
      }

      const { data: profs, error } = await supabase
        .from("profiles")
        .select("id, display_name, email, role, participant_record_id")
        .in("id", ids)
        .eq("role", "participant");

      if (error) { list.innerHTML = "<div class='muted'>Failed to load participants.</div>"; return; }

      participants = profs || [];
      const recordIds = participants.map(c => c.participant_record_id).filter(Boolean);
      let activeByRecordId = new Map();
      if (recordIds.length > 0) {
        const { data: records, error: recordError } = await supabase
          .from("records")
          .select("id, active")
          .in("id", recordIds)
          .eq("project_id", PROJECT_ID);
        if (recordError) { list.innerHTML = "<div class='muted'>Failed to load participant status.</div>"; return; }
        activeByRecordId = new Map((records || []).map(record => [record.id, record.active !== false]));
      }
      participants = participants.map((participant) => ({
        ...participant,
        participant_active: activeByRecordId.get(participant.participant_record_id) === true,
      }));
    }

    participantRows = participants;
    participantPage = 1;
    renderParticipantRows();
    participantsLoaded = true;
  }

  // Load participants when tab is opened
  document.querySelector('[data-tab="participants"]').addEventListener("click", () => {
    if (!participantsLoaded) loadParticipants();
  });

  el("participantPager")?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-participant-page]");
    if (!button) return;
    const direction = button.getAttribute("data-participant-page");
    const totalPages = getParticipantPageCount();
    if (direction === "prev") participantPage = Math.max(1, participantPage - 1);
    if (direction === "next") participantPage = Math.min(totalPages, participantPage + 1);
    renderParticipantRows();
  });

  /* CSV handling */
  function parseCsv(text) {
    const rows = parseCsvRows(text).filter(row => !isBlankCsvRow(row));
    if (rows.length < 2) { showHint("CSV must have a header row and at least one data row.", true); return; }
  
    const headers = rows[0].map(normalizeCsvHeader);
    const nameIdx  = headers.indexOf("name");
    const emailIdx = headers.indexOf("email");
  
    if (nameIdx === -1 || emailIdx === -1) {
      showHint(`CSV must have "name" and "email" columns. Found: ${headers.join(", ")}`, true);
      return;
    }
  
    csvRows = [];
    for (let i = 1; i < rows.length; i++) {
      const cols  = rows[i].map(c => String(c ?? "").trim());
      const name  = cols[nameIdx]  || "";
      const email = (cols[emailIdx] || "").toLowerCase();
      csvRows.push({ name, email, hasError: !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) });
    }
  
    const validCount = csvRows.filter(r => !r.hasError).length;
    el("csvSummary").textContent = `${csvRows.length} rows - ${validCount} valid, ${csvRows.length - validCount} with errors`;
    el("csvPreviewWrap").style.display = "block";
  
    el("csvTable").innerHTML = `
      <thead><tr><th>#</th><th>Name</th><th>Email</th></tr></thead>
      <tbody>${csvRows.slice(0, 20).map((r, i) => `
        <tr class="${r.hasError ? "csv-error-row" : ""}">
          <td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td>
        </tr>`).join("")}
        ${csvRows.length > 20 ? `<tr><td colspan="3" class="muted">... and ${csvRows.length - 20} more rows</td></tr>` : ""}
      </tbody>`;
  
    el("importBtn").style.display = validCount > 0 ? "" : "none";
    clearHint();
    if (csvRows.some(r => r.hasError)) showHint("Some rows have invalid name/email and will be skipped.", false);
  }
  
  function handleCsvFile(file) {
    if (!file || !file.name.endsWith(".csv")) { showHint("Please upload a .csv file.", true); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const encoding = String(el("csvEncoding")?.value || "utf-8").trim() || "utf-8";
      try {
        const decoder = new TextDecoder(encoding, { fatal: false });
        parseCsv(decoder.decode(e.target.result));
      } catch (err) {
        console.warn("CSV decode failed, falling back to UTF-8:", err);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        parseCsv(decoder.decode(e.target.result));
      }
    };
    reader.readAsArrayBuffer(file);
  }
  
  const uploadZone = el("uploadZone");
  uploadZone.addEventListener("click", () => el("csvInput").click());
  uploadZone.addEventListener("dragover",  e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
  uploadZone.addEventListener("drop", e => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    handleCsvFile(e.dataTransfer.files[0]);
  });
  el("csvInput").addEventListener("change", e => handleCsvFile(e.target.files[0]));
  
  /* Import */
  el("importBtn").addEventListener("click", async () => {
    const validRows = csvRows.filter(r => !r.hasError);
    if (validRows.length === 0) return;
  
    el("importBtn").disabled = true;
    el("importProgress").style.display = "block";
  
    const setProgress = (pct, msg) => {
      el("progressBar").style.width = pct + "%";
      el("progressMsg").textContent  = msg;
    };
  
    const token = session.access_token;
    let done = 0, imported = 0;
    const failures = [];
  
    for (const row of validRows) {
      try {
        await importParticipant(row, token);
        imported++;
      } catch (e) {
        console.warn("Failed to import:", row.email, e);
        failures.push({ email: row.email, message: getImportErrorMessage(e) });
      }
      done++;
      setProgress(Math.round((done / validRows.length) * 100), `Imported ${imported}/${validRows.length}...`);
    }
  
    el("importBtn").disabled = false;
    el("importProgress").style.display = "none";
  
    if (failures.length > 0) {
      const firstFailure = failures[0];
      showHint(`Import failed: ${imported}/${validRows.length} imported, ${failures.length} failed. First failure: ${firstFailure.email} - ${firstFailure.message}`, true);
      if (imported > 0) {
        participantsLoaded = false;
        await loadParticipants();
      }
      return;
    }
  
    csvRows = [];
    el("csvPreviewWrap").style.display = "none";
    el("importBtn").style.display = "none";
  
    showHint(`Done - ${imported} participant${imported !== 1 ? "s" : ""} imported.`, false);
    participantsLoaded = false;
    await loadParticipants();
  });
  
  return {
    loadParticipants,
  };
}
