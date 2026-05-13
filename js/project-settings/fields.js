export function createFieldsController(ctx) {
  const { supabase, el, PROJECT_ID, showHint, escapeHtml, showConfirmDialog } = ctx;
  const fields = ctx.state.fields;
  const { isBookingField } = ctx.bookingUtils;

  const FIXED_ROLES = new Set(["email", "issue", "decision", "overall_status"]);
  const DASHBOARD_TOGGLE_ALLOWED_ROLES = new Set(["email"]);
  const DEFAULT_SELECT_OPTIONS = ["Not Started", "In Progress", "Completed", "Issue"];
  let supportsVisibilityChannels = true;
  let fieldLibrary = [];
  let fieldLibraryLoaded = false;
  
  async function loadFields() {
    let { data, error } = await supabase
      .from("fields")
      .select("id, key, label, type, sort_order, field_role, is_active, show_in_dashboard, show_in_participant_status, show_in_internal")
      .eq("project_id", PROJECT_ID)
      .order("sort_order");
    if (error && String(error.message || "").includes("show_in_participant_status")) {
      supportsVisibilityChannels = false;
      ({ data, error } = await supabase
        .from("fields")
        .select("id, key, label, type, sort_order, field_role, is_active, show_in_dashboard")
        .eq("project_id", PROJECT_ID)
        .order("sort_order"));
      data = (data || []).map((field) => ({
        ...field,
        show_in_participant_status: field.show_in_dashboard !== false,
        show_in_internal: field.is_active !== false,
      }));
    } else {
      supportsVisibilityChannels = true;
    }
    if (error) { showHint("Failed to load fields.", true); return; }
    fields.splice(0, fields.length, ...(data || []));
    renderFields();
    if (fieldLibraryLoaded) renderFieldLibrary();
    ctx.controllers.availability?.renderAvailabilityStepSummary?.();
  }
  
  function renderFields() {
    const list = el("fieldList");
    if (fields.length === 0) { list.innerHTML = "<div class='muted'>No fields found.</div>"; return; }
  
    list.innerHTML = fields.map((f) => {
      const role = String(f.field_role || "").toLowerCase();
      const isFixed = FIXED_ROLES.has(role);
      const canToggleBooking = !isFixed && String(f.type || "").toLowerCase() === "select";
      const canToggleClient = !isFixed || DASHBOARD_TOGGLE_ALLOWED_ROLES.has(role);
      const canToggleAudience = !isFixed;
      const rowClass = [
        "field-row",
        isFixed ? "fixed-row" : "",
        isFixed && canToggleClient ? "fixed-row-partial" : "",
      ].filter(Boolean).join(" ");
      return `
        <div class="${rowClass}" data-field-id="${escapeHtml(f.id)}" draggable="${isFixed ? "false" : "true"}">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <div class="field-info">
            <div class="field-name-wrap">
              <span class="field-name">${escapeHtml(f.label)}</span>
              ${!isFixed ? `<button class="btn-rename" data-rename-id="${escapeHtml(f.id)}" title="Rename label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                </svg>
              </button>` : ""}
            </div>
            <span class="field-key">${escapeHtml(f.key)}</span>
          </div>
          <div class="toggle-wrap" title="Use as Booking Step">
            <label class="toggle">
              <input type="checkbox" data-toggle-booking="${escapeHtml(f.id)}"
                ${isBookingField(f) ? "checked" : ""}
                ${canToggleBooking ? "" : "disabled"}/>
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Booking</span>
          </div>
          <div class="toggle-wrap" title="Show in Participant Status">
            <label class="toggle">
              <input type="checkbox" data-toggle-participant="${escapeHtml(f.id)}"
                ${f.show_in_participant_status !== false ? "checked" : ""}
                ${canToggleAudience ? "" : "disabled"}/>
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Participant</span>
          </div>
          <div class="toggle-wrap" title="Show in Client Dashboard">
            <label class="toggle">
              <input type="checkbox" data-toggle-client="${escapeHtml(f.id)}"
                ${f.show_in_dashboard !== false ? "checked" : ""}
                ${canToggleClient ? "" : "disabled"}/>
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Client</span>
          </div>
          <div class="toggle-wrap" title="Show in Internal Update Status">
            <label class="toggle">
              <input type="checkbox" data-toggle-internal="${escapeHtml(f.id)}"
                ${f.show_in_internal !== false ? "checked" : ""}
                ${canToggleAudience ? "" : "disabled"}/>
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Internal</span>
          </div>
        </div>`;
    }).join("");
  
    initFieldDrag(list);
  
    list.querySelectorAll("[data-rename-id]").forEach(btn => {
      btn.addEventListener("click", () => startRename(btn));
    });
  }
  
  function startRename(btn) {
    const row = btn.closest(".field-row");
    const fieldId = row.dataset.fieldId;
    const f = fields.find(x => x.id === fieldId);
    if (!f) return;
  
    const nameSpan = row.querySelector(".field-name");
    const originalLabel = f.label;
  
    const input = document.createElement("input");
    input.className = "field-name-input";
    input.value = originalLabel;
    input.maxLength = 80;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
  
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-rename-save";
    saveBtn.title = "Save";
    saveBtn.textContent = "Save";
    btn.replaceWith(saveBtn);
  
    async function doSave() {
      const newLabel = input.value.trim();
      if (!newLabel) { input.focus(); return; }
      if (newLabel === originalLabel) { cancelEdit(); return; }
      saveBtn.disabled = true;
      const { error } = await supabase.from("fields").update({ label: newLabel }).eq("id", fieldId);
      if (error) { showHint("Failed to rename: " + error.message, true); saveBtn.disabled = false; return; }
      showHint(`Renamed to "${newLabel}".`, false);
      await loadFields();
    }
  
    function cancelEdit() { renderFields(); }
  
    saveBtn.addEventListener("click", doSave);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSave(); }
      if (e.key === "Escape") { cancelEdit(); }
    });
  }
  
  function initFieldDrag(list) {
    let dragging = null;
  
    // dragstart / dragend only on draggable rows
    list.querySelectorAll(".field-row[draggable='true']").forEach(row => {
      row.addEventListener("dragstart", e => {
        dragging = row;
        row.style.opacity = ".4";
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        if (dragging) dragging.style.opacity = "";
        list.querySelectorAll(".field-row").forEach(r => r.classList.remove("drag-over"));
        dragging = null;
      });
    });
  
    // dragover / drop on ALL rows so drag doesn't get stuck on fixed rows
    list.querySelectorAll(".field-row").forEach(row => {
      row.addEventListener("dragover", e => {
        e.preventDefault();
        if (!dragging || dragging === row) return;
        if (row.classList.contains("fixed-row")) return;
        list.querySelectorAll(".field-row").forEach(r => r.classList.remove("drag-over"));
        const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        if (e.clientY < mid) list.insertBefore(dragging, row);
        else list.insertBefore(dragging, row.nextSibling);
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", e => { e.preventDefault(); row.classList.remove("drag-over"); });
    });
  }
  
  el("saveFieldsBtn").addEventListener("click", async () => {
    const rows = el("fieldList").querySelectorAll(".field-row");
    const updates = [];
    let sortOrder = 20;
  
    rows.forEach((row, idx) => {
      const id = row.dataset.fieldId;
      const f  = fields.find(x => x.id === id);
      if (!f) return;
      const bookingToggle     = row.querySelector("[data-toggle-booking]");
      const participantToggle = row.querySelector("[data-toggle-participant]");
      const clientToggle    = row.querySelector("[data-toggle-client]");
      const internalToggle  = row.querySelector("[data-toggle-internal]");
      updates.push({
        id,
        sort_order:               (idx + 1) * 10,
        field_role:               bookingToggle && !bookingToggle.disabled ? (bookingToggle.checked ? "booking" : "step") : (f.field_role || "step"),
        show_in_participant_status: participantToggle ? participantToggle.checked : (f.show_in_participant_status !== false),
        show_in_dashboard:        clientToggle    ? clientToggle.checked    : (f.show_in_dashboard !== false),
        show_in_internal:         internalToggle  ? internalToggle.checked  : (f.show_in_internal !== false),
      });
    });
  
    el("saveFieldsBtn").disabled    = true;
    el("saveFieldsBtn").textContent = "Saving...";
  
    const results = await Promise.all(updates.map(u => {
      const payload = supportsVisibilityChannels ? {
        sort_order:               u.sort_order,
        field_role:               u.field_role,
        show_in_participant_status: u.show_in_participant_status,
        show_in_dashboard:        u.show_in_dashboard,
        show_in_internal:         u.show_in_internal,
      } : {
        sort_order:        u.sort_order,
        field_role:        u.field_role,
        show_in_dashboard: u.show_in_dashboard,
        is_active:         u.show_in_internal,
      };
      return supabase.from("fields").update(payload).eq("id", u.id);
    }));
  
    el("saveFieldsBtn").disabled    = false;
    el("saveFieldsBtn").textContent = "Save Field Settings";
  
    const errs = results.filter(r => r.error);
    if (errs.length) { showHint(`${errs.length} field(s) failed to save.`, true); return; }
    showHint("Field settings saved.", false);
    await loadFields();
  });
  
  /* Add fields */
  function labelToKey(label) {
    return label.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
  }

  function isFieldInProject(key) {
    return fields.some((field) => String(field.key || "").trim().toLowerCase() === String(key || "").trim().toLowerCase());
  }

  function normalizeLibraryField(field) {
    const type = String(field?.type || "select").trim().toLowerCase();
    const fieldRole = type === "select" && String(field?.field_role || "").trim().toLowerCase() === "booking" ? "booking" : "step";
    let rawOptions = field?.options;
    if (typeof rawOptions === "string") {
      try { rawOptions = JSON.parse(rawOptions); } catch { rawOptions = []; }
    }
    const options = Array.isArray(rawOptions) ? rawOptions.filter(Boolean) : [];
    return {
      key: String(field?.key || "").trim(),
      label: String(field?.label || "").trim(),
      type: ["select", "text", "date"].includes(type) ? type : "select",
      field_role: fieldRole,
      options,
    };
  }

  function renderFieldLibrary() {
    const list = el("fieldLibraryList");
    if (!list) return;
    if (!fieldLibraryLoaded) {
      list.innerHTML = "<div class='muted small'>Loading library...</div>";
      return;
    }
    if (fieldLibrary.length === 0) {
      list.innerHTML = "<div class='muted small'>No reusable fields found.</div>";
      return;
    }

    list.innerHTML = fieldLibrary.map((field) => {
      const added = isFieldInProject(field.key);
      const typeLabel = field.field_role === "booking" ? "booking" : field.type;
      return `
        <div class="field-lib-item ${added ? "field-lib-added" : ""}" data-lib-key="${escapeHtml(field.key)}" title="${escapeHtml(field.label)}">
          <span class="field-lib-label">${escapeHtml(field.label)}</span>
          <span class="field-lib-type">${escapeHtml(typeLabel)}</span>
          <span class="field-lib-action">${added ? "Added" : "+"}</span>
        </div>`;
    }).join("");

    list.querySelectorAll(".field-lib-item:not(.field-lib-added)").forEach((item) => {
      item.addEventListener("click", () => addFieldFromLibrary(item.dataset.libKey));
    });
  }

  async function loadFieldLibrary() {
    const list = el("fieldLibraryList");
    if (list) list.innerHTML = "<div class='muted small'>Loading library...</div>";

    let data = null;
    let error = null;
    const rpcResult = await supabase.rpc("get_project_field_library_for_settings", { p_project_id: PROJECT_ID });
    if (!rpcResult.error) {
      data = rpcResult.data || [];
    } else {
      console.warn("Falling back to fields query for field library:", rpcResult.error);
      const fallback = await supabase
        .from("fields")
        .select("key, label, type, field_role, options")
        .in("field_role", ["step", "booking"])
        .eq("is_active", true)
        .order("label");
      data = fallback.data || [];
      error = fallback.error;
    }

    if (error) {
      fieldLibraryLoaded = true;
      fieldLibrary = [];
      renderFieldLibrary();
      showHint("Failed to load field library.", true);
      return;
    }

    const byKey = new Map();
    (data || []).map(normalizeLibraryField).forEach((field) => {
      if (!field.key || !field.label || FIXED_ROLES.has(field.field_role)) return;
      if (!byKey.has(field.key)) byKey.set(field.key, field);
    });
    fieldLibrary = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
    fieldLibraryLoaded = true;
    renderFieldLibrary();
  }

  async function confirmAddFieldWithExistingRecords(label) {
    const { count: recordCount } = await supabase
      .from("records")
      .select("*", { count: "exact", head: true })
      .eq("project_id", PROJECT_ID);
    if (!recordCount) return true;
    return showConfirmDialog({
      title: "Add Field to Existing Project",
      subtitle: "Existing participants will not be filled automatically.",
      message:
        `This project already has ${recordCount} participant${recordCount === 1 ? "" : "s"}.\n\n` +
        `Adding "${label}" now will leave this field empty for existing participants until someone fills it in manually.`,
      confirmText: "Add Field",
      cancelText: "Cancel",
    });
  }

  function buildFieldPayload({ key, label, type, options, field_role }) {
    const cleanType = ["select", "text", "date"].includes(type) ? type : "select";
    const maxSort = fields.reduce((max, field) => Math.max(max, field.sort_order || 0), 0);
    const payload = {
      project_id: PROJECT_ID,
      key,
      label,
      type: cleanType,
      options: cleanType === "select" ? (Array.isArray(options) && options.length ? options : DEFAULT_SELECT_OPTIONS) : null,
      sort_order: maxSort + 10,
      field_role: cleanType === "select" && field_role === "booking" ? "booking" : "step",
      is_active: true,
      show_in_participant_status: true,
      show_in_dashboard: true,
      show_in_internal: true,
    };
    if (!supportsVisibilityChannels) {
      delete payload.show_in_participant_status;
      delete payload.show_in_internal;
    }
    return payload;
  }

  async function addFieldFromLibrary(key) {
    const field = fieldLibrary.find((item) => item.key === key);
    if (!field) return;
    if (isFieldInProject(field.key)) {
      renderFieldLibrary();
      return;
    }
    if (!await confirmAddFieldWithExistingRecords(field.label)) return;

    const item = [...(el("fieldLibraryList")?.querySelectorAll("[data-lib-key]") || [])]
      .find((node) => node.dataset.libKey === field.key);
    item?.classList.add("field-lib-added");
    const { error } = await supabase.from("fields").insert(buildFieldPayload(field));
    if (error) {
      item?.classList.remove("field-lib-added");
      showHint("Error: " + error.message, true);
      renderFieldLibrary();
      return;
    }
    showHint(`Field "${field.label}" added.`, false);
    await loadFields();
  }

  el("newFieldLabel").addEventListener("input", () => {
    el("newFieldKey").value = labelToKey(el("newFieldLabel").value);
  });
  
  function syncNewFieldTypeOptions() {
    const isSelect = el("newFieldType").value === "select";
    el("newFieldOptionsGroup").style.display = isSelect ? "" : "none";
    el("newFieldBookingGroup").style.display = isSelect ? "" : "none";
    if (!isSelect) el("newFieldBooking").checked = false;
  }

  el("newFieldType").addEventListener("change", syncNewFieldTypeOptions);
  syncNewFieldTypeOptions();
  
  function addCustomOption() {
    const val = el("customOptionInput").value.trim();
    if (!val) return;
    const item = document.createElement("label");
    item.className = "option-item custom-opt-item";
    item.innerHTML = `<input type="checkbox" value="${escapeHtml(val)}" checked/><span>${escapeHtml(val)}</span><button type="button" class="remove-opt" title="Remove">x</button>`;
    item.querySelector(".remove-opt").addEventListener("click", (e) => { e.preventDefault(); item.remove(); });
    el("optionsList").appendChild(item);
    el("customOptionInput").value = "";
  }
  el("addCustomOptBtn").addEventListener("click", addCustomOption);
  el("customOptionInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCustomOption(); } });
  
  el("addFieldBtn").addEventListener("click", async () => {
    const label = el("newFieldLabel").value.trim();
    const key   = el("newFieldKey").value.trim();
    const type  = el("newFieldType").value;
  
    if (!label) { showHint("Label is required.", true); return; }
    if (!key)   { showHint("Key is required.", true); return; }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) { showHint("Key must start with a letter and contain only lowercase letters, numbers, and underscores.", true); return; }
    if (isFieldInProject(key)) { showHint(`Key "${key}" is already used by another field.`, true); return; }
  
    let options = null;
    if (type === "select") {
      options = [...el("optionsList").querySelectorAll("input[type='checkbox']:checked")]
        .map(cb => cb.value.trim()).filter(Boolean);
      if (options.length < 1) { showHint("Select at least one option for a select field.", true); return; }
    }
  
    if (!await confirmAddFieldWithExistingRecords(label)) return;
  
    el("addFieldBtn").disabled    = true;
    el("addFieldBtn").textContent = "Adding...";
  
    const payload = buildFieldPayload({
      key,
      label,
      type,
      options,
      field_role: type === "select" && el("newFieldBooking").checked ? "booking" : "step",
    });
    const { error } = await supabase.from("fields").insert(payload);
  
    el("addFieldBtn").disabled    = false;
    el("addFieldBtn").textContent = "Add Field";
  
    if (error) { showHint("Error: " + error.message, true); return; }
  
    // Reset form
    el("newFieldLabel").value = "";
    el("newFieldKey").value   = "";
    el("newFieldType").value  = "select";
    el("newFieldBooking").checked = false;
    el("newFieldOptionsGroup").style.display = "";
    syncNewFieldTypeOptions();
    el("optionsList").querySelectorAll(".custom-opt-item").forEach(item => item.remove());
    el("optionsList").querySelectorAll("input[type='checkbox']").forEach(cb => { cb.checked = true; });
    el("customOptionInput").value = "";
  
    showHint(`Field "${label}" added.`, false);
    await loadFields();
  });
  
  return {
    loadFields,
    loadFieldLibrary,
  };
}
