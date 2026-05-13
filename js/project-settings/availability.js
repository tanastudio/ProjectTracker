export function createAvailabilityController(ctx) {
  const { supabase, el, PROJECT_ID, showHint, escapeHtml, showConfirmDialog } = ctx;
  const session = ctx.session;
  const fields = ctx.state.fields;
  const {
    BOOKING_TIMEZONES,
    formatDateKeyInTimezone,
    formatSlotDateTime,
    formatSlotTimeInTimezone,
    formatTimezoneLabel,
    getDateKeyForTimezone,
    getDefaultBookingTimezone,
    getTodayKey,
    isBookingField,
    normalizeTimeText,
  } = ctx.bookingUtils;

  const MAX_AVAILABILITY_TIME_ROWS = 10;
  let availabilityTimezone = getDefaultBookingTimezone("Asia/Bangkok");
  let availabilityMonth = new Date();
  availabilityMonth = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth(), 1);
  let availabilitySelectedDates = new Set();
  let availabilityActiveDate = "";
  let availabilityHourRows = [];
  let availabilitySlots = [];
  let availabilityBookingsBySlot = new Map();
  let availabilitySlotsSupported = true;
  let availabilityStepSettings = new Map();
  let availabilityConsultants = [];
  let availabilitySelectedFieldId = "";
  let availabilitySelectedConsultantByField = new Map();
  let availabilityStepSettingsSupported = true;
  let availabilityConsultantsSupported = true;
  let availabilityPreviewTimezone = availabilityTimezone;
  let availabilityPreviewMonth = new Date();
  availabilityPreviewMonth = new Date(availabilityPreviewMonth.getFullYear(), availabilityPreviewMonth.getMonth(), 1);
  let availabilityPreviewSelectedDate = "";
  let availabilityPreviewConsultantId = "";
  
  function dateKeyFromParts(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  
  function parseDateKey(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function formatAvailabilityDateLabel(dateKey, options = { month: "short", day: "numeric", year: "numeric" }) {
    const date = parseDateKey(dateKey);
    return date ? new Intl.DateTimeFormat("en-US", options).format(date) : String(dateKey || "");
  }

  function getSortedAvailabilitySelectedDates() {
    return [...availabilitySelectedDates].sort();
  }

  function setAvailabilityActiveDate(dateKey) {
    availabilityActiveDate = String(dateKey || "");
  }

  function removeAvailabilitySelectedDate(dateKey) {
    const key = String(dateKey || "");
    availabilitySelectedDates.delete(key);
    if (availabilityActiveDate === key) {
      availabilityActiveDate = getSortedAvailabilitySelectedDates()[0] || "";
    }
    renderAvailabilityCalendar();
    renderAvailabilitySelectedSummary();
    renderAvailabilityActiveDaySlots();
  }

  function clearAvailabilitySelectedDates() {
    availabilitySelectedDates = new Set();
    availabilityActiveDate = "";
    renderAvailabilityCalendar();
    renderAvailabilitySelectedSummary();
    renderAvailabilityActiveDaySlots();
  }

  function getAvailabilityBookingFields() {
    return (fields || [])
      .filter((f) => (
        String(f.type || "").toLowerCase() === "select" &&
        f.is_active !== false &&
        String(f.field_role || "").toLowerCase() !== "overall_status" &&
        isBookingField(f)
      ))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  function getAvailabilitySelectedField() {
    const bookingFields = getAvailabilityBookingFields();
    if (!bookingFields.length) return null;
    if (!availabilitySelectedFieldId || !bookingFields.some((field) => String(field.id) === availabilitySelectedFieldId)) {
      availabilitySelectedFieldId = String(bookingFields[0].id);
    }
    return bookingFields.find((field) => String(field.id) === availabilitySelectedFieldId) || bookingFields[0];
  }

  function getAvailabilityStepSetting(fieldId) {
    return availabilityStepSettings.get(String(fieldId || "")) || null;
  }

  function isAvailabilityStepEnabled(fieldId) {
    const setting = getAvailabilityStepSetting(fieldId);
    return setting?.is_enabled === true;
  }

  function requireAvailabilityFieldId() {
    const field = getAvailabilitySelectedField();
    return field ? String(field.id || "") : "";
  }

  function getAvailabilityConsultantsForField(fieldId = requireAvailabilityFieldId()) {
    const targetFieldId = String(fieldId || "");
    if (!targetFieldId) return [];
    return (availabilityConsultants || [])
      .filter((consultant) => String(consultant.field_id || "") === targetFieldId && consultant.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  function formatAvailabilityConsultantLabel(consultant) {
    if (!consultant) return "";
    const name = String(consultant.name || "").trim();
    const email = String(consultant.email || "").trim();
    if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} (${email})`;
    return name || email || "Consultant";
  }

  function normalizeAvailabilityEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getSlotConsultant(slot) {
    return slot?.project_availability_consultants || slot?.consultant || {
      id: slot?.consultant_id,
      name: slot?.consultant_name,
      email: slot?.consultant_email,
      is_active: true,
    };
  }

  function isCurrentProjectAvailabilitySlot(slot) {
    return String(slot?.project_id || "") === String(PROJECT_ID || "");
  }

  function getAvailabilitySlotField(slot) {
    const fieldId = String(slot?.field_id || "");
    const localField = (fields || []).find((field) => String(field.id || "") === fieldId);
    if (localField) return localField;
    if (slot?.field_label || slot?.field_key) {
      return {
        id: slot?.field_id,
        label: slot?.field_label || "",
        key: slot?.field_key || "",
      };
    }
    return null;
  }

  function getAvailabilitySlotStepLabel(slot) {
    const field = getAvailabilitySlotField(slot);
    return field?.label || field?.key || "Booking step";
  }

  function getAvailabilitySlotContextLabel(slot) {
    const stepLabel = getAvailabilitySlotStepLabel(slot);
    const projectLabel = String(slot?.project_name || "").trim();
    if (!isCurrentProjectAvailabilitySlot(slot) && projectLabel) return `${projectLabel} / ${stepLabel}`;
    return stepLabel;
  }

  function getAvailabilityBookingLabel(booking, slot) {
    if (!booking?.id) return "";
    if (!isCurrentProjectAvailabilitySlot(slot) && String(booking.project_id || "") !== String(PROJECT_ID || "")) {
      return "booked in another project";
    }
    const record = booking.records || {};
    return `booked by ${record.title || record.code || "participant"}`;
  }

  function normalizeAvailabilityGlobalSlot(row) {
    const consultant = {
      id: row?.consultant_id,
      name: row?.consultant_name || "",
      email: row?.consultant_email || "",
      is_active: true,
    };
    return {
      id: row?.id,
      project_id: row?.project_id,
      project_name: row?.project_name || "",
      field_id: row?.field_id,
      field_label: row?.field_label || "",
      field_key: row?.field_key || "",
      consultant_id: row?.consultant_id,
      consultant_name: row?.consultant_name || "",
      consultant_email: row?.consultant_email || "",
      consultant_sort_order: row?.consultant_sort_order,
      slot_date: row?.slot_date,
      start_time: row?.start_time,
      end_time: row?.end_time,
      timezone: row?.timezone,
      is_active: row?.is_active,
      project_availability_consultants: consultant,
    };
  }

  function normalizeAvailabilityGlobalBooking(row) {
    if (!row?.booking_id) return null;
    return {
      id: row.booking_id,
      project_id: row.booking_project_id,
      slot_id: row.id,
      record_id: row.booking_record_id,
      field_id: row.booking_field_id,
      consultant_id: row.booking_consultant_id,
      consultant_name: row.booking_consultant_name,
      consultant_email: row.booking_consultant_email,
      status: row.booking_status,
      booked_at: row.booked_at,
      records: {
        code: row.record_code || "",
        title: row.record_title || "",
      },
    };
  }

  function doesAvailabilitySlotMatchConsultant(slot, consultant) {
    if (!consultant) return true;
    const selectedEmail = normalizeAvailabilityEmail(consultant.email);
    const slotEmail = normalizeAvailabilityEmail(getSlotConsultant(slot)?.email || slot?.consultant_email);
    if (selectedEmail && slotEmail) return selectedEmail === slotEmail;
    return String(slot?.consultant_id || "") === String(consultant.id || "");
  }

  function getAvailabilitySlotDisplayDateKey(slot) {
    return formatDateKeyInTimezone(slot, availabilityTimezone || "Asia/Bangkok");
  }

  function getAvailabilitySlotDisplayTimeLabel(slot) {
    return formatSlotTimeInTimezone(slot, availabilityTimezone || "Asia/Bangkok") || formatSlotTimeInTimezone(slot, slot?.timezone || "Asia/Bangkok");
  }

  function getAvailabilitySelectedConsultant(fieldId = requireAvailabilityFieldId()) {
    const targetFieldId = String(fieldId || "");
    if (!targetFieldId) return null;
    const consultants = getAvailabilityConsultantsForField(targetFieldId);
    if (!consultants.length) {
      availabilitySelectedConsultantByField.delete(targetFieldId);
      return null;
    }
    let consultantId = String(availabilitySelectedConsultantByField.get(targetFieldId) || "");
    if (!consultantId || !consultants.some((consultant) => String(consultant.id || "") === consultantId)) {
      consultantId = String(consultants[0].id || "");
      availabilitySelectedConsultantByField.set(targetFieldId, consultantId);
    }
    return consultants.find((consultant) => String(consultant.id || "") === consultantId) || consultants[0] || null;
  }

  function canEditAvailabilitySlots() {
    const fieldId = requireAvailabilityFieldId();
    return Boolean(fieldId && isAvailabilityStepEnabled(fieldId) && getAvailabilitySelectedConsultant(fieldId));
  }

  function getAvailabilitySlotCounts() {
    const counts = new Map();
    const consultant = getAvailabilitySelectedConsultant();
    if (!consultant) return counts;
    for (const slot of availabilitySlots || []) {
      if (slot.is_active === false) continue;
      if (!doesAvailabilitySlotMatchConsultant(slot, consultant)) continue;
      const key = getAvailabilitySlotDisplayDateKey(slot);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
  
  function renderAvailabilityCalendar() {
    const grid = el("availabilityCalendarGrid");
    const label = el("availabilityMonthLabel");
    if (!grid || !label) return;
  
    label.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(availabilityMonth);
    grid.innerHTML = "";
  
    const year = availabilityMonth.getFullYear();
    const monthIndex = availabilityMonth.getMonth();
    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const slotCounts = getAvailabilitySlotCounts();
    const todayKey = getTodayKey();
    const selectedFieldId = requireAvailabilityFieldId();
    const stepEnabled = selectedFieldId ? isAvailabilityStepEnabled(selectedFieldId) : false;
    const canEditSlots = canEditAvailabilitySlots();
  
    for (let i = 0; i < firstDay.getDay(); i++) {
      const cell = document.createElement("div");
      cell.className = "availability-day-cell";
      grid.appendChild(cell);
    }
  
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = dateKeyFromParts(year, monthIndex, day);
      const cell = document.createElement("div");
      cell.className = "availability-day-cell";
  
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = [
        "availability-day-btn",
        availabilitySelectedDates.has(dateKey) ? "selected" : "",
        availabilityActiveDate === dateKey ? "active" : "",
        slotCounts.has(dateKey) ? "has-slot" : "",
        dateKey === todayKey ? "today" : "",
      ].filter(Boolean).join(" ");
      btn.textContent = String(day);
      btn.title = slotCounts.has(dateKey) ? `${slotCounts.get(dateKey)} active slot(s)` : dateKey;
      btn.disabled = !selectedFieldId || !stepEnabled || !canEditSlots;
      btn.addEventListener("click", (event) => {
        if (!selectedFieldId || !stepEnabled || !canEditSlots) return;
        if ((event.ctrlKey || event.metaKey || event.altKey) && availabilitySelectedDates.has(dateKey)) {
          removeAvailabilitySelectedDate(dateKey);
          return;
        }
        availabilitySelectedDates.add(dateKey);
        setAvailabilityActiveDate(dateKey);
        renderAvailabilityCalendar();
        renderAvailabilitySelectedSummary();
        renderAvailabilityActiveDaySlots();
      });
  
      cell.appendChild(btn);
      grid.appendChild(cell);
    }
  }
  
  function renderAvailabilitySelectedSummary() {
    const node = el("availabilitySelectedSummary");
    if (!node) return;
    const dates = getSortedAvailabilitySelectedDates();
    if (!dates.length) {
      node.textContent = "No dates selected.";
      return;
    }
    node.innerHTML = "";

    const head = document.createElement("div");
    head.className = "availability-selected-head";
    const title = document.createElement("div");
    title.className = "availability-selected-title";
    title.textContent = `Selected ${dates.length} date${dates.length === 1 ? "" : "s"} for Apply Slots`;
    const clear = document.createElement("button");
    clear.className = "availability-clear-btn";
    clear.type = "button";
    clear.textContent = "Clear";
    clear.addEventListener("click", clearAvailabilitySelectedDates);
    head.appendChild(title);
    head.appendChild(clear);
    node.appendChild(head);

    const chips = document.createElement("div");
    chips.className = "availability-date-chips";
    for (const dateKey of dates) {
      const chip = document.createElement("button");
      chip.className = ["availability-date-chip", availabilityActiveDate === dateKey ? "active" : ""].filter(Boolean).join(" ");
      chip.type = "button";
      chip.title = "Click to preview this date";
      const label = document.createElement("span");
      label.textContent = formatAvailabilityDateLabel(dateKey);
      const remove = document.createElement("span");
      remove.className = "availability-date-chip-remove";
      remove.textContent = "x";
      remove.title = "Remove from selected dates";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeAvailabilitySelectedDate(dateKey);
      });
      chip.addEventListener("click", () => {
        setAvailabilityActiveDate(dateKey);
        renderAvailabilityCalendar();
        renderAvailabilitySelectedSummary();
        renderAvailabilityActiveDaySlots();
      });
      chip.appendChild(label);
      chip.appendChild(remove);
      chips.appendChild(chip);
    }
    node.appendChild(chips);
  }

  function getAvailabilitySlotsForActiveDate() {
    if (!availabilityActiveDate) return [];
    const consultant = getAvailabilitySelectedConsultant();
    if (!consultant) return [];
    return (availabilitySlots || [])
      .filter((slot) => (
        slot.is_active !== false &&
        getAvailabilitySlotDisplayDateKey(slot) === availabilityActiveDate &&
        doesAvailabilitySlotMatchConsultant(slot, consultant)
      ))
      .sort((a, b) => getAvailabilitySlotDisplayTimeLabel(a).localeCompare(getAvailabilitySlotDisplayTimeLabel(b)) || getAvailabilitySlotStepLabel(a).localeCompare(getAvailabilitySlotStepLabel(b)));
  }

  function renderAvailabilityActiveDaySlots() {
    const panel = el("availabilityActiveDayPanel");
    if (!panel) return;
    const selectedField = getAvailabilitySelectedField();
    const consultant = getAvailabilitySelectedConsultant();
    panel.innerHTML = "";

    const head = document.createElement("div");
    head.className = "availability-active-day-head";
    const copy = document.createElement("div");
    const title = document.createElement("div");
    title.className = "availability-active-day-title";
    title.textContent = availabilityActiveDate
      ? `Viewing slots for ${formatAvailabilityDateLabel(availabilityActiveDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`
      : "Viewing slots";
    const sub = document.createElement("div");
    sub.className = "availability-active-day-sub";
    sub.textContent = consultant
      ? `${formatAvailabilityConsultantLabel(consultant)} - all projects and booking steps`
      : "Select a consultant and date to preview saved slots.";
    copy.appendChild(title);
    copy.appendChild(sub);
    head.appendChild(copy);
    panel.appendChild(head);

    if (!selectedField) {
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "Select a booking step first.";
      panel.appendChild(empty);
      return;
    }

    if (!availabilityActiveDate) {
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "No date selected.";
      panel.appendChild(empty);
      return;
    }

    const slots = getAvailabilitySlotsForActiveDate();
    if (!slots.length) {
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "No saved slots for this day and consultant across projects yet.";
      panel.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "availability-active-slot-list";
    for (const slot of slots) {
      const booking = availabilityBookingsBySlot.get(String(slot.id || ""));
      const isCurrentProjectSlot = isCurrentProjectAvailabilitySlot(slot);
      const isCurrentStepSlot = String(slot.field_id || "") === String(selectedField.id || "");
      const slotContextLabel = getAvailabilitySlotContextLabel(slot);
      const row = document.createElement("div");
      row.className = [
        "availability-active-slot-row",
        booking ? "booked" : "",
        isCurrentProjectSlot && isCurrentStepSlot ? "" : "other-step",
      ].filter(Boolean).join(" ");

      const text = document.createElement("div");
      const time = document.createElement("div");
      time.className = "availability-active-slot-time";
      time.textContent = getAvailabilitySlotDisplayTimeLabel(slot);
      const meta = document.createElement("div");
      meta.className = "availability-active-slot-meta";
      const bookingLabel = getAvailabilityBookingLabel(booking, slot);
      meta.textContent = booking
        ? `${slotContextLabel} - ${bookingLabel}`
        : `${slotContextLabel} - ${formatTimezoneLabel(availabilityTimezone || "Asia/Bangkok")}`;
      text.appendChild(time);
      text.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "availability-slot-actions";
      if (!isCurrentProjectSlot) {
        const badge = document.createElement("span");
        badge.className = "muted small";
        badge.textContent = "Other project";
        actions.appendChild(badge);
      } else if (!isCurrentStepSlot) {
        const badge = document.createElement("span");
        badge.className = "muted small";
        badge.textContent = "Other step";
        actions.appendChild(badge);
      } else if (booking) {
        const cancel = document.createElement("button");
        cancel.className = "btn-ghost";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => cancelAvailabilityBooking(booking, cancel));
        actions.appendChild(cancel);
      }
      if (isCurrentProjectSlot && isCurrentStepSlot) {
        const remove = document.createElement("button");
        remove.className = "btn-danger-sm";
        remove.type = "button";
        remove.textContent = booking ? "Cancel & Remove" : "Remove";
        remove.addEventListener("click", () => removeAvailabilitySlot(slot, booking, remove));
        actions.appendChild(remove);
      }

      row.appendChild(text);
      row.appendChild(actions);
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  function renderAvailabilityHours() {
    const rows = el("availabilityHourRows");
    if (!rows) return;
    rows.innerHTML = "";
    const canEditSlots = canEditAvailabilitySlots();

    availabilityHourRows.forEach((row, index) => {
      const wrap = document.createElement("div");
      wrap.className = "availability-hour-row";
  
      const start = document.createElement("input");
      start.className = "form-input";
      start.type = "time";
      start.value = row.start || "09:00";
      start.disabled = !canEditSlots;
      start.addEventListener("input", () => { availabilityHourRows[index].start = start.value; });
  
      const end = document.createElement("input");
      end.className = "form-input";
      end.type = "time";
      end.value = row.end || "17:00";
      end.disabled = !canEditSlots;
      end.addEventListener("input", () => { availabilityHourRows[index].end = end.value; });

      const separator = document.createElement("span");
      separator.className = "availability-time-separator";
      separator.textContent = "-";

      const remove = document.createElement("button");
      remove.className = "availability-remove-btn";
      remove.type = "button";
      remove.textContent = "x";
      remove.title = "Remove time range";
      remove.disabled = !canEditSlots;
      remove.addEventListener("click", () => {
        availabilityHourRows.splice(index, 1);
        renderAvailabilityHours();
      });

      wrap.appendChild(start);
      wrap.appendChild(separator);
      wrap.appendChild(end);
      wrap.appendChild(remove);
      rows.appendChild(wrap);
    });

    const addButton = el("availabilityAddHourBtn");
    if (addButton) addButton.disabled = !canEditSlots || availabilityHourRows.length >= MAX_AVAILABILITY_TIME_ROWS;
    const applyButton = el("availabilityApplyBtn");
    if (applyButton) applyButton.disabled = !canEditSlots || !availabilityHourRows.length;
  }
  
  function getValidAvailabilityHours() {
    const valid = [];
    for (const row of availabilityHourRows) {
      const start = normalizeTimeText(row.start);
      const end = normalizeTimeText(row.end);
      if (!start || !end) continue;
      if (end <= start) throw new Error("End time must be after start time.");
      valid.push({ start, end });
    }
    if (!valid.length) throw new Error("Add at least one valid time range.");
    return valid;
  }

  function getNextAvailabilityDraftRange() {
    const last = availabilityHourRows[availabilityHourRows.length - 1];
    if (!last?.end) return { start: "09:00", end: "10:00" };
    const [hour, minute] = normalizeTimeText(last.end).split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { start: "09:00", end: "10:00" };
    const startMinutes = hour * 60 + minute;
    const endMinutes = Math.min(startMinutes + 60, 24 * 60);
    const formatMinutes = (total) => {
      const clamped = Math.max(0, Math.min(total, 24 * 60));
      const h = Math.floor(clamped / 60);
      const m = clamped % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    if (startMinutes >= 23 * 60) return { start: "09:00", end: "10:00" };
    return { start: formatMinutes(startMinutes), end: formatMinutes(endMinutes) };
  }

  function populateAvailabilityTimezoneSelect() {
    const select = el("availabilityTimezone");
    if (!select) return;
    select.innerHTML = "";
    for (const zone of BOOKING_TIMEZONES) {
      const option = document.createElement("option");
      option.value = zone.value;
      option.textContent = formatTimezoneLabel(zone.value);
      select.appendChild(option);
    }
    select.value = availabilityTimezone;
    select.addEventListener("change", () => {
      availabilityTimezone = select.value || "Asia/Bangkok";
      renderAvailabilityCalendar();
      renderAvailabilityActiveDaySlots();
    });
  }

  function renderAvailabilityConsultantSelect() {
    const select = el("availabilityConsultantSelect");
    const notice = el("availabilityConsultantNotice");
    if (!select) return;
    const fieldId = requireAvailabilityFieldId();
    const enabled = fieldId ? isAvailabilityStepEnabled(fieldId) : false;
    const consultants = getAvailabilityConsultantsForField(fieldId);
    const selected = getAvailabilitySelectedConsultant(fieldId);

    select.innerHTML = "";
    if (!fieldId) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Select a booking step first";
      select.appendChild(option);
      select.disabled = true;
    } else if (!consultants.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved consultants";
      select.appendChild(option);
      select.disabled = true;
    } else {
      for (const consultant of consultants) {
        const option = document.createElement("option");
        option.value = String(consultant.id || "");
        option.textContent = formatAvailabilityConsultantLabel(consultant);
        select.appendChild(option);
      }
      select.value = String(selected?.id || consultants[0]?.id || "");
      select.disabled = !enabled;
    }

    select.onchange = () => {
      if (fieldId) availabilitySelectedConsultantByField.set(fieldId, select.value || "");
      availabilitySelectedDates = new Set();
      availabilityActiveDate = "";
      renderAvailabilityCalendar();
      renderAvailabilitySelectedSummary();
      renderAvailabilityActiveDaySlots();
      renderAvailabilityHours();
      renderAvailabilitySlotList();
    };

    if (notice) {
      if (!fieldId) {
        notice.textContent = "Select a booking step before setting availability.";
        notice.className = "availability-editor-note";
      } else if (!enabled) {
        notice.textContent = "Enable the booking calendar for this step before setting availability.";
        notice.className = "availability-editor-note";
      } else if (!consultants.length) {
        notice.textContent = "Add and save at least one consultant before creating availability.";
        notice.className = "availability-editor-note warning";
      } else {
        notice.textContent = "Slots you apply now will belong to this consultant.";
        notice.className = "availability-editor-note";
      }
    }
  }

  function renderAvailabilitySlotList() {
    const list = el("availabilitySlotList");
    if (!list) return;
    const selectedField = getAvailabilitySelectedField();
    if (!selectedField) {
      list.innerHTML = `<div class="muted">No booking steps found yet.</div>`;
      return;
    }
    const activeSlots = (availabilitySlots || [])
      .filter((slot) => (
        slot.is_active !== false &&
        isCurrentProjectAvailabilitySlot(slot) &&
        String(slot.field_id || "") === String(selectedField.id || "")
      ))
      .sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`));
  
    if (!availabilitySlotsSupported) {
      list.innerHTML = `<div class="muted">Availability tables are not available yet. Run the latest Supabase migration.</div>`;
      return;
    }
  
    if (!activeSlots.length) {
      list.innerHTML = `<div class="muted">No active slots configured for ${escapeHtml(selectedField.label || selectedField.key)}.</div>`;
      return;
    }
  
    list.innerHTML = "";
    for (const slot of activeSlots) {
      const booking = availabilityBookingsBySlot.get(String(slot.id || ""));
      const row = document.createElement("div");
      row.className = ["availability-slot-row", booking ? "booked" : ""].filter(Boolean).join(" ");
  
      const copy = document.createElement("div");
      const title = document.createElement("div");
      title.className = "availability-slot-title";
      title.textContent = formatSlotDateTime(slot);
      const consultant = getSlotConsultant(slot);
      const consultantLine = document.createElement("div");
      consultantLine.className = "availability-slot-consultant";
      consultantLine.textContent = formatAvailabilityConsultantLabel(consultant) || "Unassigned consultant";
      const meta = document.createElement("div");
      meta.className = "availability-slot-meta";
      meta.textContent = `${getAvailabilitySlotContextLabel(slot)} - ${formatTimezoneLabel(slot.timezone || "Asia/Bangkok")}`;
      copy.appendChild(title);
      copy.appendChild(consultantLine);
      copy.appendChild(meta);
      if (booking) {
        const booked = document.createElement("div");
        booked.className = "availability-slot-booking";
        const record = booking.records || {};
        booked.textContent = `Booked by ${record.title || record.code || "participant"}`;
        copy.appendChild(booked);
      }

      const actions = document.createElement("div");
      actions.className = "availability-slot-actions";
      if (booking) {
        const cancel = document.createElement("button");
        cancel.className = "btn-ghost";
        cancel.type = "button";
        cancel.textContent = "Cancel Booking";
        cancel.addEventListener("click", () => cancelAvailabilityBooking(booking, cancel));
        actions.appendChild(cancel);
      }

      const remove = document.createElement("button");
      remove.className = "btn-danger-sm";
      remove.type = "button";
      remove.textContent = booking ? "Cancel & Remove" : "Remove Slot";
      remove.addEventListener("click", () => removeAvailabilitySlot(slot, booking, remove));
      actions.appendChild(remove);

      row.appendChild(copy);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  async function cancelAvailabilityBooking(booking, button) {
    if (!booking?.id) return;
    if (!confirm("Cancel this booking and make the slot available again?")) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Cancelling...";
    }
    const { error } = await supabase.rpc("cancel_project_availability_booking", {
      p_booking_id: booking.id,
    });
    if (error) {
      showHint("Failed to cancel booking: " + error.message, true);
      if (button) {
        button.disabled = false;
        button.textContent = "Cancel Booking";
      }
      return;
    }
    await loadAvailabilitySlots();
    showHint("Booking cancelled. The slot is available again.", false);
  }

  async function removeAvailabilitySlot(slot, booking, button) {
    if (!slot?.id) return;
    const hasBooking = Boolean(booking?.id);
    const message = hasBooking
      ? "This slot is booked. Cancel the booking and remove the slot from the calendar?"
      : "Remove this slot from the participant calendar?";
    if (!confirm(message)) return;
    if (button) {
      button.disabled = true;
      button.textContent = hasBooking ? "Removing..." : "Removing...";
    }
    const { error } = await supabase.rpc("remove_project_availability_slot", {
      p_slot_id: slot.id,
      p_cancel_booking: hasBooking,
    });
    if (error) {
      showHint("Failed to remove slot: " + error.message, true);
      if (button) {
        button.disabled = false;
        button.textContent = hasBooking ? "Cancel & Remove" : "Remove Slot";
      }
      return;
    }
    await loadAvailabilitySlots();
    showHint(hasBooking ? "Booking cancelled and slot removed." : "Slot removed.", false);
  }

  function renderAvailabilityStepSummary() {
    const node = el("availabilityStepSummary");
    if (!node) return;
    const bookingFields = getAvailabilityBookingFields();
    if (!bookingFields.length) {
      node.innerHTML = `<span class="muted small">No booking or schedule select fields found yet.</span>`;
      availabilitySelectedFieldId = "";
      renderAvailabilityStepConfig();
      renderAvailabilityCalendar();
      renderAvailabilityActiveDaySlots();
      renderAvailabilitySlotList();
      return;
    }
    if (!availabilitySelectedFieldId || !bookingFields.some((field) => String(field.id) === availabilitySelectedFieldId)) {
      availabilitySelectedFieldId = String(bookingFields[0].id);
    }
    node.innerHTML = "";
    for (const field of bookingFields) {
      const fieldId = String(field.id || "");
      const enabled = isAvailabilityStepEnabled(fieldId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "availability-step-pill",
        availabilitySelectedFieldId === fieldId ? "active" : "",
        enabled ? "" : "disabled",
      ].filter(Boolean).join(" ");
      button.dataset.availabilityFieldId = fieldId;
      button.innerHTML = `${escapeHtml(field.label || field.key)} <span class="availability-step-status">${enabled ? "On" : "Off"}</span>`;
      button.addEventListener("click", async () => {
        availabilitySelectedFieldId = fieldId;
        availabilitySelectedDates = new Set();
        availabilityActiveDate = "";
        renderAvailabilityStepSummary();
        renderAvailabilitySelectedSummary();
        renderAvailabilityActiveDaySlots();
        renderAvailabilityHours();
        renderAvailabilityStepConfig();
        await loadAvailabilitySlots();
      });
      node.appendChild(button);
    }
    renderAvailabilityStepConfig();
  }

  function renderAvailabilityStepConfig() {
    const selectedField = getAvailabilitySelectedField();
    const enabledInput = el("availabilityStepEnabled");
    const title = el("availabilityStepConfigTitle");
    const desc = el("availabilityStepConfigDesc");
    const editor = document.querySelector(".availability-editor");
    const selectedFieldId = selectedField ? String(selectedField.id || "") : "";
    const enabled = selectedFieldId ? isAvailabilityStepEnabled(selectedFieldId) : false;

    if (title) title.textContent = selectedField ? `${selectedField.label || selectedField.key} Setup` : "Booking Step Setup";
    if (desc) {
      desc.textContent = selectedField
        ? "Enable this step, manage consultants, then set availability per consultant."
        : "Select a booking step above to manage consultants and preview the participant view.";
    }
    if (enabledInput) {
      enabledInput.checked = enabled;
      enabledInput.disabled = !selectedField || !availabilityStepSettingsSupported;
    }
    const addConsultantButton = el("availabilityAddConsultantBtn");
    if (addConsultantButton) addConsultantButton.disabled = !selectedField || !availabilityConsultantsSupported;
    const saveConsultantButton = el("availabilitySaveConsultantsBtn");
    if (saveConsultantButton) saveConsultantButton.disabled = !selectedField || !availabilityConsultantsSupported;
    const previewButton = el("availabilityPreviewBtn");
    if (previewButton) previewButton.disabled = !selectedField || !enabled;
    if (editor) editor.classList.toggle("disabled", !enabled);
    renderAvailabilityConsultantSelect();
    renderAvailabilityConsultants();
    renderAvailabilityHours();
  }

  function renderAvailabilityConsultants() {
    const rows = el("availabilityConsultantRows");
    if (!rows) return;
    rows.innerHTML = "";
    const selectedFieldId = requireAvailabilityFieldId();
    if (!selectedFieldId) {
      rows.innerHTML = `<div class="muted small">Select a booking step first.</div>`;
      return;
    }
    if (!availabilityConsultantsSupported) {
      rows.innerHTML = `<div class="muted small">Consultant settings are not available yet. Run the latest Supabase migration.</div>`;
      return;
    }
    const current = (availabilityConsultants || [])
      .filter((consultant) => String(consultant.field_id || "") === selectedFieldId && consultant.is_active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    if (!current.length) {
      appendAvailabilityConsultantRow(rows, { name: "", email: "" });
      return;
    }
    for (const consultant of current) appendAvailabilityConsultantRow(rows, consultant);
  }

  function appendAvailabilityConsultantRow(container = el("availabilityConsultantRows"), consultant = {}) {
    if (!container) return;
    const row = document.createElement("div");
    row.className = "availability-consultant-row";

    const name = document.createElement("input");
    name.className = "form-input";
    name.type = "text";
    name.placeholder = "Consultant name";
    name.value = consultant.name || "";
    name.dataset.consultantName = "true";

    const email = document.createElement("input");
    email.className = "form-input";
    email.type = "email";
    email.placeholder = "consultant@example.com";
    email.value = consultant.email || "";
    email.dataset.consultantEmail = "true";

    const remove = document.createElement("button");
    remove.className = "availability-remove-btn";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Remove consultant";
    remove.addEventListener("click", () => {
      row.remove();
      if (!container.querySelector(".availability-consultant-row")) appendAvailabilityConsultantRow(container);
    });

    row.appendChild(name);
    row.appendChild(email);
    row.appendChild(remove);
    container.appendChild(row);
  }

  async function loadAvailabilityStepSettings() {
    const bookingFields = getAvailabilityBookingFields();
    availabilityStepSettings = new Map();
    if (!bookingFields.length) {
      renderAvailabilityStepSummary();
      return;
    }
    const fieldIds = bookingFields.map((field) => field.id);
    const { data, error } = await supabase
      .from("project_availability_step_settings")
      .select("id, project_id, field_id, is_enabled")
      .eq("project_id", PROJECT_ID)
      .in("field_id", fieldIds);

    if (error) {
      availabilityStepSettingsSupported = false;
      showHint("Availability step settings are not available. Run the latest Supabase migration.", true);
      for (const field of bookingFields) {
        availabilityStepSettings.set(String(field.id), { field_id: field.id, is_enabled: true });
      }
      renderAvailabilityStepSummary();
      return;
    }

    availabilityStepSettingsSupported = true;
    for (const setting of data || []) {
      availabilityStepSettings.set(String(setting.field_id), { ...setting, is_enabled: setting.is_enabled === true });
    }

    const missing = bookingFields.filter((field) => !availabilityStepSettings.has(String(field.id)));
    if (missing.length) {
      const payload = missing.map((field) => ({
        project_id: PROJECT_ID,
        field_id: field.id,
        is_enabled: false,
        created_by: session.user.id,
      }));
      const { data: inserted, error: insertError } = await supabase
        .from("project_availability_step_settings")
        .upsert(payload, { onConflict: "project_id,field_id" })
        .select("id, project_id, field_id, is_enabled");
      if (insertError) {
        showHint("Failed to initialize booking step settings: " + insertError.message, true);
      } else {
        for (const setting of inserted || []) {
          availabilityStepSettings.set(String(setting.field_id), { ...setting, is_enabled: setting.is_enabled === true });
        }
      }
    }

    renderAvailabilityStepSummary();
  }

  async function setAvailabilityStepEnabled(enabled) {
    const fieldId = requireAvailabilityFieldId();
    if (!fieldId || !availabilityStepSettingsSupported) return;
    const { data, error } = await supabase
      .from("project_availability_step_settings")
      .upsert({
        project_id: PROJECT_ID,
        field_id: fieldId,
        is_enabled: enabled,
        created_by: session.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_id,field_id" })
      .select("id, project_id, field_id, is_enabled")
      .maybeSingle();
    if (error) {
      showHint("Failed to update booking step: " + error.message, true);
      renderAvailabilityStepConfig();
      return;
    }
    availabilityStepSettings.set(fieldId, { ...data, is_enabled: data?.is_enabled === true });
    if (!enabled) {
      availabilitySelectedDates = new Set();
      availabilityActiveDate = "";
    }
    renderAvailabilityStepSummary();
    renderAvailabilitySelectedSummary();
    renderAvailabilityCalendar();
    renderAvailabilityActiveDaySlots();
    renderAvailabilityHours();
    await loadAvailabilitySlots();
    showHint(`${enabled ? "Enabled" : "Disabled"} booking calendar for this step.`, false);
  }

  async function loadAvailabilityConsultants() {
    const { data, error } = await supabase
      .from("project_availability_consultants")
      .select("id, project_id, field_id, name, email, is_active, sort_order")
      .eq("project_id", PROJECT_ID)
      .order("sort_order", { ascending: true });
    if (error) {
      availabilityConsultantsSupported = false;
      availabilityConsultants = [];
      renderAvailabilityStepConfig();
      return;
    }
    availabilityConsultantsSupported = true;
    availabilityConsultants = data || [];
    renderAvailabilityStepConfig();
    renderAvailabilityCalendar();
    renderAvailabilitySlotList();
  }

  async function saveAvailabilityConsultants() {
    const fieldId = requireAvailabilityFieldId();
    if (!fieldId) {
      showHint("Select a booking step first.", true);
      return;
    }
    const rows = [...(el("availabilityConsultantRows")?.querySelectorAll(".availability-consultant-row") || [])];
    const consultants = [];
    const seenEmails = new Set();
    const previousSelected = getAvailabilitySelectedConsultant(fieldId);
    const previousSelectedEmail = String(previousSelected?.email || "").trim().toLowerCase();
    for (const [index, row] of rows.entries()) {
      const name = String(row.querySelector("[data-consultant-name]")?.value || "").trim();
      const email = String(row.querySelector("[data-consultant-email]")?.value || "").trim().toLowerCase();
      if (!name && !email) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showHint("Enter a valid consultant email.", true);
        return;
      }
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      consultants.push({
        project_id: PROJECT_ID,
        field_id: fieldId,
        name: name || email,
        email,
        is_active: true,
        sort_order: index,
        updated_at: new Date().toISOString(),
      });
    }

    const saveButton = el("availabilitySaveConsultantsBtn");
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    const { error } = await supabase.rpc("replace_project_availability_consultants", {
      p_project_id: PROJECT_ID,
      p_field_id: fieldId,
      p_consultants: consultants.map(({ name, email }) => ({ name, email })),
    });
    if (error) {
      showHint("Failed to save consultants: " + error.message, true);
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save Consultants";
      }
      return;
    }
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Save Consultants";
    }
    await loadAvailabilityConsultants();
    if (previousSelectedEmail) {
      const restored = getAvailabilityConsultantsForField(fieldId)
        .find((consultant) => String(consultant.email || "").trim().toLowerCase() === previousSelectedEmail);
      if (restored?.id) availabilitySelectedConsultantByField.set(fieldId, String(restored.id));
    }
    await loadAvailabilitySlots();
    renderAvailabilityStepConfig();
    renderAvailabilityCalendar();
    renderAvailabilitySlotList();
    showHint("Consultants saved.", false);
  }

  function getAvailabilityPreviewSlotsByDate() {
    const today = getDateKeyForTimezone(availabilityPreviewTimezone);
    const byDate = new Map();
    const fieldId = requireAvailabilityFieldId();
    const consultantFilter = String(availabilityPreviewConsultantId || "");
    const groups = new Map();
    for (const slot of availabilitySlots || []) {
      if (slot.is_active === false) continue;
      if (!isCurrentProjectAvailabilitySlot(slot)) continue;
      if (fieldId && String(slot.field_id || "") !== String(fieldId)) continue;
      if (availabilityBookingsBySlot.has(String(slot.id))) continue;
      if (consultantFilter && String(slot.consultant_id || "") !== consultantFilter) continue;
      const dateKey = formatDateKeyInTimezone(slot, availabilityPreviewTimezone);
      if (!dateKey || dateKey < today) continue;
      const timeLabel = formatSlotTimeInTimezone(slot, availabilityPreviewTimezone);
      const key = `${dateKey}::${timeLabel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          dateKey,
          timeLabel,
          slots: [],
          consultantNames: new Set(),
        });
      }
      const group = groups.get(key);
      group.slots.push(slot);
      const consultant = getSlotConsultant(slot);
      const label = formatAvailabilityConsultantLabel(consultant);
      if (label) group.consultantNames.add(label);
    }
    for (const group of groups.values()) {
      if (!byDate.has(group.dateKey)) byDate.set(group.dateKey, []);
      byDate.get(group.dateKey).push(group);
    }
    for (const options of byDate.values()) {
      options.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
    }
    return byDate;
  }

  function ensureAvailabilityPreviewState(slotsByDate) {
    const firstDateKey = [...slotsByDate.keys()].sort()[0] || getDateKeyForTimezone(availabilityPreviewTimezone);
    if (!availabilityPreviewSelectedDate || !slotsByDate.has(availabilityPreviewSelectedDate)) {
      availabilityPreviewSelectedDate = firstDateKey;
    }
    const selectedDate = parseDateKey(availabilityPreviewSelectedDate) || parseDateKey(firstDateKey) || new Date();
    if (!availabilityPreviewMonth) availabilityPreviewMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  }

  function renderAvailabilityPreviewModal() {
    const body = el("availabilityPreviewBody");
    const title = el("availabilityPreviewTitle");
    const desc = el("availabilityPreviewDesc");
    const selectedField = getAvailabilitySelectedField();
    if (!body || !selectedField) return;

    const previewConsultants = getAvailabilityConsultantsForField(String(selectedField.id || ""));
    if (availabilityPreviewConsultantId && !previewConsultants.some((consultant) => String(consultant.id || "") === availabilityPreviewConsultantId)) {
      availabilityPreviewConsultantId = "";
    }
    const slotsByDate = getAvailabilityPreviewSlotsByDate();
    ensureAvailabilityPreviewState(slotsByDate);
    const selectedOptions = slotsByDate.get(availabilityPreviewSelectedDate) || [];
    if (title) title.textContent = selectedField.label || selectedField.key || "Booking Preview";
    if (desc) desc.textContent = "Global preview for this booking step. It does not require a participant record.";

    body.innerHTML = "";
    const hero = document.createElement("div");
    hero.className = "availability-preview-hero";
    hero.innerHTML = `
      <h3 class="availability-preview-title">${escapeHtml(selectedField.label || selectedField.key || "Booking")}</h3>
      <div class="availability-preview-meta">
        <span>Configured time ranges</span>
        <span>Confirmation email to participant and consultant</span>
      </div>`;
    body.appendChild(hero);

    const content = document.createElement("div");
    content.className = "availability-preview-body";
    const heading = document.createElement("h3");
    heading.className = "availability-preview-title";
    heading.style.fontSize = "20px";
    heading.textContent = "Select a Date & Time";
    content.appendChild(heading);

    if (previewConsultants.length) {
      const filter = document.createElement("div");
      filter.className = "availability-preview-filter";
      const filterLabel = document.createElement("label");
      filterLabel.textContent = "Consultant";
      const filterSelect = document.createElement("select");
      filterSelect.className = "form-select";
      const anyOption = document.createElement("option");
      anyOption.value = "";
      anyOption.textContent = "Any consultant";
      filterSelect.appendChild(anyOption);
      for (const consultant of previewConsultants) {
        const option = document.createElement("option");
        option.value = String(consultant.id || "");
        option.textContent = formatAvailabilityConsultantLabel(consultant);
        filterSelect.appendChild(option);
      }
      filterSelect.value = availabilityPreviewConsultantId || "";
      filterSelect.addEventListener("change", () => {
        availabilityPreviewConsultantId = filterSelect.value || "";
        availabilityPreviewSelectedDate = "";
        renderAvailabilityPreviewModal();
      });
      filter.appendChild(filterLabel);
      filter.appendChild(filterSelect);
      content.appendChild(filter);
    }

    if (!slotsByDate.size) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No available slots are open for this booking step.";
      content.appendChild(empty);
      body.appendChild(content);
      return;
    }

    const layout = document.createElement("div");
    layout.className = "availability-preview-layout";
    const calendar = document.createElement("div");
    const monthHead = document.createElement("div");
    monthHead.className = "availability-month-head";

    const prev = document.createElement("button");
    prev.className = "availability-nav-btn";
    prev.type = "button";
    prev.textContent = "‹";
    prev.addEventListener("click", () => {
      availabilityPreviewMonth = new Date(availabilityPreviewMonth.getFullYear(), availabilityPreviewMonth.getMonth() - 1, 1);
      renderAvailabilityPreviewModal();
    });

    const monthLabel = document.createElement("div");
    monthLabel.className = "availability-month-label";
    monthLabel.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(availabilityPreviewMonth);

    const next = document.createElement("button");
    next.className = "availability-nav-btn";
    next.type = "button";
    next.textContent = "›";
    next.addEventListener("click", () => {
      availabilityPreviewMonth = new Date(availabilityPreviewMonth.getFullYear(), availabilityPreviewMonth.getMonth() + 1, 1);
      renderAvailabilityPreviewModal();
    });

    monthHead.appendChild(prev);
    monthHead.appendChild(monthLabel);
    monthHead.appendChild(next);
    calendar.appendChild(monthHead);

    const weekdays = document.createElement("div");
    weekdays.className = "availability-weekdays";
    for (const dayName of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      const day = document.createElement("div");
      day.className = "availability-weekday";
      day.textContent = dayName;
      weekdays.appendChild(day);
    }
    calendar.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "availability-day-grid";
    const year = availabilityPreviewMonth.getFullYear();
    const monthIndex = availabilityPreviewMonth.getMonth();
    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    for (let i = 0; i < firstDay.getDay(); i++) {
      const cell = document.createElement("div");
      cell.className = "availability-day-cell";
      grid.appendChild(cell);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = dateKeyFromParts(year, monthIndex, day);
      const hasSlots = slotsByDate.has(dateKey);
      const cell = document.createElement("div");
      cell.className = "availability-day-cell";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = [
        "availability-day-btn",
        hasSlots ? "has-slot" : "",
        availabilityPreviewSelectedDate === dateKey ? "selected" : "",
      ].filter(Boolean).join(" ");
      btn.textContent = String(day);
      btn.disabled = !hasSlots;
      if (hasSlots) {
        btn.addEventListener("click", () => {
          availabilityPreviewSelectedDate = dateKey;
          renderAvailabilityPreviewModal();
        });
      }
      cell.appendChild(btn);
      grid.appendChild(cell);
    }
    calendar.appendChild(grid);

    const timezoneRow = document.createElement("div");
    timezoneRow.className = "availability-preview-timezone";
    const timezoneLabel = document.createElement("label");
    timezoneLabel.textContent = "Time zone";
    const timezoneSelect = document.createElement("select");
    timezoneSelect.className = "form-select";
    for (const zone of BOOKING_TIMEZONES) {
      const option = document.createElement("option");
      option.value = zone.value;
      option.textContent = formatTimezoneLabel(zone.value);
      timezoneSelect.appendChild(option);
    }
    timezoneSelect.value = availabilityPreviewTimezone;
    timezoneSelect.addEventListener("change", () => {
      availabilityPreviewTimezone = timezoneSelect.value || "Asia/Bangkok";
      availabilityPreviewSelectedDate = "";
      renderAvailabilityPreviewModal();
    });
    timezoneRow.appendChild(timezoneLabel);
    timezoneRow.appendChild(timezoneSelect);
    calendar.appendChild(timezoneRow);

    const times = document.createElement("div");
    const selectedLabel = document.createElement("div");
    selectedLabel.className = "availability-preview-selected";
    selectedLabel.textContent = parseDateKey(availabilityPreviewSelectedDate)
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(parseDateKey(availabilityPreviewSelectedDate))
      : availabilityPreviewSelectedDate;
    times.appendChild(selectedLabel);
    const timeList = document.createElement("div");
    timeList.className = "availability-preview-time-list";
    if (!selectedOptions.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No available times for this date.";
      timeList.appendChild(empty);
    } else {
      for (const option of selectedOptions) {
        const time = document.createElement("button");
        time.className = "availability-preview-time";
        time.type = "button";
        const consultantNames = [...option.consultantNames];
        const detail = availabilityPreviewConsultantId
          ? (consultantNames[0] || "Selected consultant")
          : `${consultantNames.length || option.slots.length} consultant${(consultantNames.length || option.slots.length) === 1 ? "" : "s"} available`;
        time.innerHTML = `<span>${escapeHtml(option.timeLabel)}</span><small>${escapeHtml(detail)}</small>`;
        time.disabled = true;
        timeList.appendChild(time);
      }
    }
    times.appendChild(timeList);

    layout.appendChild(calendar);
    layout.appendChild(times);
    content.appendChild(layout);
    body.appendChild(content);
  }

  function openAvailabilityPreviewModal() {
    const selectedField = getAvailabilitySelectedField();
    if (!selectedField) {
      showHint("Select a booking step first.", true);
      return;
    }
    availabilityPreviewTimezone = availabilityTimezone || getDefaultBookingTimezone("Asia/Bangkok");
    availabilityPreviewSelectedDate = "";
    availabilityPreviewConsultantId = "";
    availabilityPreviewMonth = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth(), 1);
    renderAvailabilityPreviewModal();
    const modal = el("availabilityPreviewModal");
    modal?.classList.add("open");
    modal?.setAttribute("aria-hidden", "false");
  }

  function closeAvailabilityPreviewModal() {
    const modal = el("availabilityPreviewModal");
    modal?.classList.remove("open");
    modal?.setAttribute("aria-hidden", "true");
  }

  async function loadAvailabilitySlots() {
    const list = el("availabilitySlotList");
    if (list) list.innerHTML = `<div class="muted">Loading slots...</div>`;
    const fieldId = requireAvailabilityFieldId();
    if (!fieldId) {
      availabilitySlots = [];
      availabilityBookingsBySlot = new Map();
      renderAvailabilityCalendar();
      renderAvailabilityActiveDaySlots();
      renderAvailabilitySlotList();
      return;
    }

    const { data: globalData, error: globalError } = await supabase.rpc("get_project_global_consultant_availability_slots_for_settings", {
      p_project_id: PROJECT_ID,
    });

    if (!globalError) {
      availabilitySlotsSupported = true;
      availabilitySlots = (globalData || []).map(normalizeAvailabilityGlobalSlot);
      availabilityBookingsBySlot = new Map();
      for (const row of globalData || []) {
        const booking = normalizeAvailabilityGlobalBooking(row);
        if (booking) availabilityBookingsBySlot.set(String(row.id || ""), booking);
      }
      renderAvailabilityCalendar();
      renderAvailabilityActiveDaySlots();
      renderAvailabilitySlotList();
      return;
    }

    console.warn("Global availability slots unavailable:", globalError.message || globalError);

    const { data, error } = await supabase
      .from("project_availability_slots")
      .select("id, project_id, field_id, consultant_id, slot_date, start_time, end_time, timezone, is_active, project_availability_consultants(id,name,email,is_active)")
      .eq("project_id", PROJECT_ID)
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });
  
    if (error) {
      availabilitySlotsSupported = false;
      availabilitySlots = [];
      availabilityBookingsBySlot = new Map();
      renderAvailabilityCalendar();
      renderAvailabilityActiveDaySlots();
      renderAvailabilitySlotList();
      return;
    }

    availabilitySlotsSupported = true;
    availabilitySlots = data || [];
    availabilityBookingsBySlot = new Map();
    const { data: bookings, error: bookingError } = await supabase
      .from("project_availability_bookings")
      .select("id, project_id, slot_id, record_id, field_id, consultant_id, consultant_name, consultant_email, status, booked_at, records(code,title)")
      .eq("project_id", PROJECT_ID)
      .eq("status", "booked");
    if (!bookingError) {
      for (const booking of bookings || []) {
        availabilityBookingsBySlot.set(String(booking.slot_id || ""), booking);
      }
    } else {
      console.warn("Failed to load slot bookings:", bookingError.message || bookingError);
    }
    renderAvailabilityCalendar();
    renderAvailabilityActiveDaySlots();
    renderAvailabilitySlotList();
  }
  
  async function applyAvailabilitySlots() {
    const fieldId = requireAvailabilityFieldId();
    if (!fieldId) {
      showHint("Select a booking step first.", true);
      return;
    }
    if (!isAvailabilityStepEnabled(fieldId)) {
      showHint("Enable booking calendar for this step before applying slots.", true);
      return;
    }
    const consultant = getAvailabilitySelectedConsultant(fieldId);
    if (!consultant?.id) {
      showHint("Add, save, and select a consultant before applying slots.", true);
      return;
    }
    if (!availabilitySelectedDates.size) {
      showHint("Select at least one date.", true);
      return;
    }
  
    let hours;
    try {
      hours = getValidAvailabilityHours();
    } catch (err) {
      showHint(err.message || "Invalid time range.", true);
      return;
    }

    const payload = [];
    for (const dateKey of [...availabilitySelectedDates]) {
      for (const hour of hours) {
        payload.push({
          project_id: PROJECT_ID,
          field_id: fieldId,
          consultant_id: consultant.id,
          slot_date: dateKey,
          start_time: hour.start,
          end_time: hour.end,
          timezone: availabilityTimezone || "Asia/Bangkok",
          is_active: true,
          created_by: session.user.id,
          updated_at: new Date().toISOString(),
        });
      }
    }
  
    if (!payload.length) {
      showHint("No slots fit inside the selected time ranges.", true);
      return;
    }
  
    const button = el("availabilityApplyBtn");
    if (button) {
      button.disabled = true;
      button.textContent = "Applying...";
    }
  
    let savedCount = 0;
    const failures = [];
    for (const slotPayload of payload) {
      const { error } = await supabase
        .from("project_availability_slots")
        .upsert(slotPayload, { onConflict: "project_id,field_id,consultant_id,slot_date,start_time" });
      if (error) failures.push({ slot: slotPayload, message: error.message || "Unknown error" });
      else savedCount += 1;
    }

    if (button) {
      button.disabled = false;
      button.textContent = "Apply Slots";
    }

    await loadAvailabilitySlots();

    if (failures.length) {
      const first = failures[0];
      const firstLabel = `${first.slot.slot_date} ${first.slot.start_time} - ${first.slot.end_time}`;
      showHint(`${savedCount} slot${savedCount === 1 ? "" : "s"} saved. ${failures.length} skipped. First skipped: ${firstLabel}: ${first.message}`, true);
      return;
    }

    renderAvailabilitySelectedSummary();
    renderAvailabilityCalendar();
    renderAvailabilityActiveDaySlots();
    availabilityHourRows = [];
    renderAvailabilityHours();
    showHint(`${payload.length} slot${payload.length === 1 ? "" : "s"} saved.`, false);
  }
  
  el("availabilityPrevMonth")?.addEventListener("click", () => {
    availabilityMonth = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() - 1, 1);
    renderAvailabilityCalendar();
  });
  el("availabilityNextMonth")?.addEventListener("click", () => {
    availabilityMonth = new Date(availabilityMonth.getFullYear(), availabilityMonth.getMonth() + 1, 1);
    renderAvailabilityCalendar();
  });
  el("availabilityAddHourBtn")?.addEventListener("click", () => {
    if (availabilityHourRows.length >= MAX_AVAILABILITY_TIME_ROWS) {
      showHint(`Maximum ${MAX_AVAILABILITY_TIME_ROWS} time ranges per apply.`, true);
      return;
    }
    availabilityHourRows.push(getNextAvailabilityDraftRange());
    renderAvailabilityHours();
  });
  el("availabilityApplyBtn")?.addEventListener("click", () => applyAvailabilitySlots().catch(console.error));
  el("availabilityRefreshBtn")?.addEventListener("click", () => loadAvailabilitySlots().catch(console.error));
  el("availabilityStepEnabled")?.addEventListener("change", (event) => {
    setAvailabilityStepEnabled(event.target.checked).catch(console.error);
  });
  el("availabilityAddConsultantBtn")?.addEventListener("click", () => appendAvailabilityConsultantRow());
  el("availabilitySaveConsultantsBtn")?.addEventListener("click", () => saveAvailabilityConsultants().catch(console.error));
  el("availabilityPreviewBtn")?.addEventListener("click", () => openAvailabilityPreviewModal());
  el("availabilityPreviewCloseBtn")?.addEventListener("click", () => closeAvailabilityPreviewModal());
  el("availabilityPreviewModal")?.addEventListener("click", (event) => {
    if (event.target === el("availabilityPreviewModal")) closeAvailabilityPreviewModal();
  });
  populateAvailabilityTimezoneSelect();
  renderAvailabilityHours();
  renderAvailabilitySelectedSummary();
  renderAvailabilityActiveDaySlots();
  
  return {
    loadAvailabilityStepSettings,
    loadAvailabilityConsultants,
    loadAvailabilitySlots,
    renderAvailabilityStepSummary,
  };
}
