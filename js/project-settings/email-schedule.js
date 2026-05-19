export function createEmailScheduleController(ctx) {
  const { supabase, el, PROJECT_ID, showHint, clearHint, escapeHtml, ordinalDayLabel, getFunctionErrorMessage } = ctx;
  const session = ctx.session;
  const members = ctx.state.members;
  const {
    describeProjectUpdateSchedule,
    normalizeMonthDays,
    normalizeProjectUpdateSchedule,
    normalizeWeekdays,
    validateProjectUpdateSchedule,
  } = ctx.projectUpdateEmailUtils;

  let clientUpdateSettings = {
    ...normalizeProjectUpdateSchedule({
      is_enabled: false,
      schedule_type: "weekly",
      weekly_days: [1],
      monthly_days: [],
      send_hour: 9,
      send_minute: 0,
      timezone: "Asia/Bangkok",
    }),
    audit_emails: [],
  };
  
  let internalUpdateSettings = normalizeProjectUpdateSchedule({
    is_enabled: false,
    schedule_type: "weekly",
    weekly_days: [5],
    monthly_mode: "dates",
    monthly_days: [],
    send_hour: 9,
    send_minute: 0,
    timezone: "Asia/Bangkok",
  });
  let internalPortfolioProjects = [];
  let internalPortfolioRecipients = [];
  let emailRunHistory = [];
  let emailHistoryLastSent = {
    client: null,
    internal: null,
  };
  
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());
  }
  
  function normalizeEmailList(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => isValidEmail(value)))];
  }
  
  function formatTimeInputValue(hour, minute) {
    return `${String(Number(hour ?? 9)).padStart(2, "0")}:${String(Number(minute ?? 0)).padStart(2, "0")}`;
  }
  
  function parseTimeInputValue(value) {
    const [hourText, minuteText] = String(value || "09:00").split(":");
    const hour = Math.min(23, Math.max(0, Number.isFinite(Number(hourText)) ? Number(hourText) : 9));
    const minute = Math.min(59, Math.max(0, Number.isFinite(Number(minuteText)) ? Number(minuteText) : 0));
    return { hour, minute };
  }
  
  function readTimeInput(inputId) {
    const input = el(inputId);
    const [hourText, minuteText] = String(input?.value || "09:00").split(":");
    return {
      send_hour: Number.isFinite(Number(hourText)) ? Number(hourText) : 9,
      send_minute: Number.isFinite(Number(minuteText)) ? Number(minuteText) : 0,
    };
  }
  
  function writeTimeInput(inputId, schedule) {
    const input = el(inputId);
    if (!input) return;
    setTimePickerValue(inputId, schedule?.send_hour, schedule?.send_minute, { emit: false });
  }
  
  function closeTimePickers(exceptPicker = null) {
    document.querySelectorAll(".time-picker.open").forEach((picker) => {
      if (picker !== exceptPicker) picker.classList.remove("open");
    });
  }
  
  function syncTimePickerView(inputId) {
    const input = el(inputId);
    const picker = document.querySelector(`[data-time-picker="${inputId}"]`);
    if (!input || !picker) return;
  
    const { hour, minute } = parseTimeInputValue(input.value);
    const value = formatTimeInputValue(hour, minute);
    input.value = value;
    picker.querySelector("[data-time-display]").textContent = value;
    picker.querySelectorAll("[data-time-hour]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.timeHour) === hour);
    });
    picker.querySelectorAll("[data-time-minute]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.timeMinute) === minute);
    });
  }
  
  function scrollActiveTimeOptions(picker) {
    picker.querySelectorAll(".time-picker-option.active").forEach((button) => {
      button.scrollIntoView({ block: "nearest" });
    });
  }
  
  function setTimePickerValue(inputId, hour, minute, options = {}) {
    const input = el(inputId);
    if (!input) return;
    input.value = formatTimeInputValue(hour, minute);
    syncTimePickerView(inputId);
    if (options.emit) input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  
  function buildTimePickerPanel(inputId) {
    const hourButtons = Array.from({ length: 24 }, (_, hour) => `
      <button class="time-picker-option" type="button" data-time-hour="${hour}">${String(hour).padStart(2, "0")}</button>
    `).join("");
    const minuteButtons = Array.from({ length: 60 }, (_, minute) => `
      <button class="time-picker-option" type="button" data-time-minute="${minute}">${String(minute).padStart(2, "0")}</button>
    `).join("");
  
    return `
      <div class="time-picker-columns" data-time-input="${escapeHtml(inputId)}">
        <div>
          <div class="time-picker-column-title">Hour</div>
          <div class="time-picker-options">${hourButtons}</div>
        </div>
        <div>
          <div class="time-picker-column-title">Minute</div>
          <div class="time-picker-options">${minuteButtons}</div>
        </div>
      </div>
    `;
  }
  
  function initTimePickers() {
    document.querySelectorAll("[data-time-picker]").forEach((picker) => {
      const inputId = picker.getAttribute("data-time-picker");
      const panel = picker.querySelector("[data-time-panel]");
      if (!inputId || !panel) return;
  
      panel.innerHTML = buildTimePickerPanel(inputId);
      picker.querySelector("[data-time-toggle]").addEventListener("click", (event) => {
        event.stopPropagation();
        const shouldOpen = !picker.classList.contains("open");
        closeTimePickers(picker);
        picker.classList.toggle("open", shouldOpen);
        if (shouldOpen) requestAnimationFrame(() => scrollActiveTimeOptions(picker));
      });
  
      panel.addEventListener("click", (event) => {
        const button = event.target.closest("[data-time-hour], [data-time-minute]");
        if (!button) return;
        event.stopPropagation();
        const current = parseTimeInputValue(el(inputId)?.value);
        const hour = button.hasAttribute("data-time-hour") ? Number(button.dataset.timeHour) : current.hour;
        const minute = button.hasAttribute("data-time-minute") ? Number(button.dataset.timeMinute) : current.minute;
        setTimePickerValue(inputId, hour, minute, { emit: true });
        if (button.hasAttribute("data-time-minute")) picker.classList.remove("open");
      });
  
      syncTimePickerView(inputId);
    });
  
    document.addEventListener("click", () => closeTimePickers());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTimePickers();
    });
  }
  
  function getMembersByProfileRoles(roles) {
    return members.filter((member) => roles.includes(String(member?.profile?.role || "").trim().toLowerCase()));
  }
  
  function renderRecipientList(targetId, roleLabels) {
    const wrap = el(targetId);
    if (!wrap) return;
  
    const recipients = getMembersByProfileRoles(roleLabels);
    if (recipients.length === 0) {
      wrap.innerHTML = "<div class='muted'>No matching project members found yet.</div>";
      return recipients;
    }
  
    const visibleRecipients = recipients.slice(0, 3);
    const remainingCount = recipients.length - visibleRecipients.length;
    wrap.innerHTML = visibleRecipients.map((member) => {
      const name = member?.profile?.display_name || member.user_id;
      const role = String(member?.profile?.role || "").trim().toLowerCase();
      return `
        <div class="recipient-item">
          <div class="recipient-name">${escapeHtml(name)}</div>
          <div class="recipient-role">${escapeHtml(role)} member</div>
        </div>
      `;
    }).join("") + (remainingCount > 0 ? `
      <div class="recipient-item">
        <div class="recipient-name">+${remainingCount} more</div>
        <div class="recipient-role">${escapeHtml(roleLabels.join("/"))} members</div>
      </div>
    ` : "");
  
    return recipients;
  }
  
  function getSelectedChipValues(selector, normalizer) {
    return normalizer(
      [...document.querySelectorAll(`${selector}.active`)].map((node) => node.getAttribute(node.getAttributeNames().find((name) => name.startsWith("data-"))))
    );
  }
  
  function getClientScheduleState() {
    const sendTime = readTimeInput("projectUpdateTimeInput");
    return normalizeProjectUpdateSchedule({
      is_enabled: el("projectUpdateEnabled")?.checked,
      schedule_type: document.querySelector("[data-update-type].active")?.getAttribute("data-update-type") || "weekly",
      weekly_days: [...document.querySelectorAll("[data-weekday].active")].map((node) => node.getAttribute("data-weekday")),
      monthly_days: [...document.querySelectorAll("[data-monthday].active")].map((node) => node.getAttribute("data-monthday")),
      send_hour: sendTime.send_hour,
      send_minute: sendTime.send_minute,
      timezone: "Asia/Bangkok",
    });
  }
  
  function getInternalScheduleState() {
    const scheduleType = document.querySelector("[data-internal-update-type].active")?.getAttribute("data-internal-update-type") || "weekly";
    const sendTime = readTimeInput("internalUpdateTimeInput");
    return normalizeProjectUpdateSchedule({
      is_enabled: el("internalUpdateEnabled")?.checked,
      schedule_type: scheduleType,
      weekly_days: [...document.querySelectorAll("[data-internal-weekday].active")].map((node) => node.getAttribute("data-internal-weekday")),
      monthly_mode: scheduleType === "monthly" ? "end_of_month" : "dates",
      monthly_days: [],
      send_hour: sendTime.send_hour,
      send_minute: sendTime.send_minute,
      timezone: "Asia/Bangkok",
    });
  }
  
  function setSegmentedType(selector, type) {
    document.querySelectorAll(selector).forEach((btn) => {
      const attrName = btn.hasAttribute("data-update-type") ? "data-update-type" : "data-internal-update-type";
      btn.classList.toggle("active", btn.getAttribute(attrName) === type);
    });
  }
  
  function toggleScheduleGroups(isInternal, type) {
    if (isInternal) {
      el("internalWeeklyScheduleGroup").style.display = type === "weekly" ? "" : "none";
      el("internalMonthlyScheduleGroup").style.display = type === "monthly" ? "" : "none";
      return;
    }
    el("weeklyScheduleGroup").style.display = type === "weekly" ? "" : "none";
    el("monthlyScheduleGroup").style.display = type === "monthly" ? "" : "none";
  }
  
  function renderEmailPills(targetId, emails, type) {
    const wrap = el(targetId);
    if (!wrap) return;
    if (!emails.length) {
      wrap.innerHTML = "<span class='muted small'>No emails added.</span>";
      return;
    }
    wrap.innerHTML = emails.map((email) => `
      <span class="email-pill">
        ${escapeHtml(email)}
        <button type="button" data-remove-email="${escapeHtml(email)}" data-remove-kind="${escapeHtml(type)}">x</button>
      </span>
    `).join("");
  }
  
  function renderEmailLists() {
    renderEmailPills("clientAuditList", clientUpdateSettings.audit_emails || [], "audit");
  }
  
  function formatEmailHistoryDate(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  
  function statusPill(status) {
    const normalized = String(status || "queued").trim().toLowerCase();
    const safeStatus = ["sent", "failed", "skipped", "queued"].includes(normalized) ? normalized : "queued";
    return `<span class="status-pill status-pill-${safeStatus}">${escapeHtml(safeStatus)}</span>`;
  }
  
  function formatRunSource(run) {
    const source = escapeHtml(run?.trigger_source || "unknown");
    return run?.local_send_date ? `${source}<br/><span class="muted small">${escapeHtml(run.local_send_date)}</span>` : source;
  }
  
  function formatRunRecipientList(run) {
    const primary = Array.isArray(run?.recipients) ? run.recipients : [];
    const cc = Array.isArray(run?.cc_emails) ? run.cc_emails : [];
    const bcc = Array.isArray(run?.bcc_emails) ? run.bcc_emails : [];
    const safeList = (values) => values.map((value) => escapeHtml(value)).join(", ");
    const parts = [];
    if (primary.length) parts.push(`To: ${safeList(primary)}`);
    if (cc.length) parts.push(`Audit/CC: ${safeList(cc)}`);
    if (bcc.length) parts.push(`BCC: ${safeList(bcc)}`);
    return parts.length ? parts.join("<br/>") : "No recipients recorded";
  }
  
  function getLatestRunForGroup(group) {
    return emailRunHistory.find((run) => String(run.recipient_group || "").toLowerCase() === group) || null;
  }
  
  function getLatestErrorForGroup(group) {
    return emailRunHistory.find((run) =>
      String(run.recipient_group || "").toLowerCase() === group
      && String(run.error_message || "").trim()
    ) || null;
  }
  
  function renderEmailHistorySummary(targetId, group, label, lastSentAt) {
    const wrap = el(targetId);
    if (!wrap) return;
    const latestRun = getLatestRunForGroup(group);
    const latestError = getLatestErrorForGroup(group);
    const fallbackLastSent = latestRun?.status === "sent" ? latestRun.sent_at : null;
    const displayLastSent = lastSentAt || fallbackLastSent;
    const latestRecipients = latestRun ? formatRunRecipientList(latestRun) : "No runs recorded";
  
    wrap.innerHTML = `
      <div class="email-history-label">
        <span>${escapeHtml(label)}</span>
        ${latestRun ? statusPill(latestRun.status) : "<span class='muted small'>No runs</span>"}
      </div>
      <div class="email-history-meta">
        <strong>Last sent:</strong> ${escapeHtml(formatEmailHistoryDate(displayLastSent))}<br/>
        <strong>Latest run:</strong> ${latestRun ? escapeHtml(formatEmailHistoryDate(latestRun.created_at)) : "No runs recorded"}${latestRun ? ` (${formatRunSource(latestRun)})` : ""}<br/>
        <strong>Recipients:</strong><br/>${latestRecipients}
      </div>
      <div class="email-history-meta email-history-error">
        <strong>Latest error:</strong> ${latestError ? escapeHtml(latestError.error_message) : "No error recorded"}
      </div>
    `;
  }
  
  function renderEmailRunHistory() {
    renderEmailHistorySummary("clientEmailHistorySummary", "client", "Client Update", emailHistoryLastSent.client);
    renderEmailHistorySummary("internalEmailHistorySummary", "internal", "Internal Update", emailHistoryLastSent.internal);
  
    const body = el("emailRunHistoryRows");
    if (!body) return;
    if (!emailRunHistory.length) {
      body.innerHTML = "<tr><td colspan='6' class='muted'>No email runs recorded for this project yet.</td></tr>";
      return;
    }
  
    body.innerHTML = emailRunHistory.map((run) => `
      <tr>
        <td>${escapeHtml(formatEmailHistoryDate(run.created_at))}</td>
        <td>${escapeHtml(run.recipient_group || "client")}</td>
        <td>${formatRunSource(run)}</td>
        <td>${statusPill(run.status)}</td>
        <td class="email-run-recipients">${formatRunRecipientList(run)}</td>
        <td class="email-run-error">${run.error_message ? escapeHtml(run.error_message) : "None"}</td>
      </tr>
    `).join("");
  }
  
  async function loadEmailRunHistory() {
    const { data, error } = await supabase
      .from("project_update_email_runs")
      .select(`
        id,
        recipient_group,
        trigger_source,
        local_send_date,
        status,
        recipients,
        cc_emails,
        bcc_emails,
        error_message,
        sent_at,
        created_at
      `)
      .eq("project_id", PROJECT_ID)
      .order("created_at", { ascending: false })
      .limit(12);
  
    if (error) {
      const message = escapeHtml(error.message || "Failed to load email run history.");
      const rowWrap = el("emailRunHistoryRows");
      if (rowWrap) rowWrap.innerHTML = `<tr><td colspan="6" class="email-run-error">${message}</td></tr>`;
      ["clientEmailHistorySummary", "internalEmailHistorySummary"].forEach((targetId) => {
        const wrap = el(targetId);
        if (wrap) wrap.innerHTML = `<div class="email-run-error">Failed to load email history: ${message}</div>`;
      });
      return;
    }
  
    emailRunHistory = data || [];
    renderEmailRunHistory();
  }
  
  function renderClientUpdateSummary() {
    const schedule = getClientScheduleState();
    const recipients = getMembersByProfileRoles(["client"]);
    const summaryBox = el("projectUpdateSummaryBox");
    if (!summaryBox) return;
    summaryBox.innerHTML = `
      <strong>Current summary:</strong> ${escapeHtml(describeProjectUpdateSchedule(schedule, { longWeekday: true }))}<br/>
      <strong>Recipients:</strong> ${recipients.length} client member${recipients.length === 1 ? "" : "s"}<br/>
      <strong>Audit copy:</strong> ${(clientUpdateSettings.audit_emails || []).length} audit recipient${(clientUpdateSettings.audit_emails || []).length === 1 ? "" : "s"}
    `;
  }
  
  function renderInternalUpdateSummary() {
    const schedule = getInternalScheduleState();
    const summaryBox = el("internalUpdateSummaryBox");
    if (!summaryBox) return;
    summaryBox.innerHTML = `
      <strong>Current summary:</strong> ${escapeHtml(describeProjectUpdateSchedule(schedule, { longWeekday: true }))}<br/>
      <strong>Projects included:</strong> ${internalPortfolioProjects.length} active project${internalPortfolioProjects.length === 1 ? "" : "s"}<br/>
      <strong>Recipients:</strong> ${internalPortfolioRecipients.length} internal/admin member${internalPortfolioRecipients.length === 1 ? "" : "s"}
    `;
  }
  
  function renderInternalPortfolioContext() {
    const projectWrap = el("internalUpdateProjectScope");
    if (projectWrap) {
      const visibleProjects = internalPortfolioProjects.slice(0, 3);
      const remainingProjects = internalPortfolioProjects.length - visibleProjects.length;
      projectWrap.innerHTML = internalPortfolioProjects.length
        ? visibleProjects.map((project) => `
          <div class="recipient-item">
            <div class="recipient-name">${escapeHtml(project.name || "Project")}</div>
            <div class="recipient-role">active project</div>
          </div>
        `).join("") + (remainingProjects > 0 ? `
          <div class="recipient-item">
            <div class="recipient-name">+${remainingProjects} more</div>
            <div class="recipient-role">active projects</div>
          </div>
        ` : "")
        : "<div class='muted'>No active projects found.</div>";
    }
  
    const recipientWrap = el("internalUpdateRecipients");
    if (recipientWrap) {
      const visibleRecipients = internalPortfolioRecipients.slice(0, 3);
      const remainingRecipients = internalPortfolioRecipients.length - visibleRecipients.length;
      recipientWrap.innerHTML = internalPortfolioRecipients.length
        ? visibleRecipients.map((member) => `
          <div class="recipient-item">
            <div class="recipient-name">${escapeHtml(member.display_name || member.id)}</div>
            <div class="recipient-role">${escapeHtml(member.role)} member</div>
          </div>
        `).join("") + (remainingRecipients > 0 ? `
          <div class="recipient-item">
            <div class="recipient-name">+${remainingRecipients} more</div>
            <div class="recipient-role">internal/admin members</div>
          </div>
        ` : "")
        : "<div class='muted'>No internal or admin members found across active projects.</div>";
    }
  }
  
  function renderProjectUpdateRecipients() {
    renderRecipientList("projectUpdateRecipients", ["client"]);
    renderInternalPortfolioContext();
    renderClientUpdateSummary();
    renderInternalUpdateSummary();
  }
  
  function syncClientUpdateForm(settings) {
    clientUpdateSettings = {
      ...normalizeProjectUpdateSchedule(settings || {}),
      audit_emails: normalizeEmailList([
        ...normalizeEmailList(settings?.cc_emails),
        ...normalizeEmailList(settings?.bcc_emails),
      ]),
    };
    el("projectUpdateEnabled").checked = clientUpdateSettings.is_enabled;
    setSegmentedType("[data-update-type]", clientUpdateSettings.schedule_type);
    toggleScheduleGroups(false, clientUpdateSettings.schedule_type);
  
    document.querySelectorAll("[data-weekday]").forEach((chip) => {
      const value = Number(chip.getAttribute("data-weekday"));
      chip.classList.toggle("active", clientUpdateSettings.weekly_days.includes(value));
    });
  
    document.querySelectorAll("[data-monthday]").forEach((chip) => {
      const value = Number(chip.getAttribute("data-monthday"));
      chip.classList.toggle("active", clientUpdateSettings.monthly_days.includes(value));
      chip.textContent = ordinalDayLabel(value);
    });
  
    writeTimeInput("projectUpdateTimeInput", clientUpdateSettings);
    renderEmailLists();
    renderClientUpdateSummary();
  }
  
  function syncInternalUpdateForm(settings) {
    internalUpdateSettings = normalizeProjectUpdateSchedule(settings || {});
    el("internalUpdateEnabled").checked = internalUpdateSettings.is_enabled;
    setSegmentedType("[data-internal-update-type]", internalUpdateSettings.schedule_type);
    toggleScheduleGroups(true, internalUpdateSettings.schedule_type);
  
    document.querySelectorAll("[data-internal-weekday]").forEach((chip) => {
      const value = Number(chip.getAttribute("data-internal-weekday"));
      chip.classList.toggle("active", internalUpdateSettings.weekly_days.includes(value));
    });
  
    document.querySelectorAll("[data-internal-month-end]").forEach((chip) => {
      chip.classList.toggle("active", internalUpdateSettings.schedule_type === "monthly");
    });
  
    writeTimeInput("internalUpdateTimeInput", internalUpdateSettings);
    renderInternalUpdateSummary();
  }
  
  async function loadInternalPortfolioContext() {
    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("status", "active")
      .order("name");
  
    if (projectError) {
      showHint("Failed to load active projects for internal summary.", true);
      return;
    }
  
    internalPortfolioProjects = projects || [];
    const projectIds = internalPortfolioProjects.map((project) => project.id);
  
    if (!projectIds.length) {
      internalPortfolioRecipients = [];
      renderInternalPortfolioContext();
      renderInternalUpdateSummary();
      return;
    }
  
    const { data: memberships, error: membershipError } = await supabase
      .from("project_members")
      .select("project_id, user_id")
      .in("project_id", projectIds);
  
    if (membershipError) {
      showHint("Failed to load internal summary recipients.", true);
      return;
    }
  
    const memberIds = [...new Set((memberships || []).map((row) => String(row.user_id)))];
    if (!memberIds.length) {
      internalPortfolioRecipients = [];
      renderInternalPortfolioContext();
      renderInternalUpdateSummary();
      return;
    }
  
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, email, role")
      .in("id", memberIds)
      .in("role", ["internal", "admin"]);
  
    if (profileError) {
      showHint("Failed to load internal recipient profiles.", true);
      return;
    }
  
    internalPortfolioRecipients = (profiles || [])
      .filter((profile, index, list) => list.findIndex((item) => item.id === profile.id) === index)
      .sort((a, b) => String(a.display_name || a.id).localeCompare(String(b.display_name || b.id)));
  
    renderInternalPortfolioContext();
    renderInternalUpdateSummary();
  }
  
  async function loadProjectUpdateSettings() {
    const { data, error } = await supabase
      .from("project_update_email_settings")
      .select(`
        project_id,
        is_enabled,
        schedule_type,
        weekly_days,
        monthly_days,
        monthly_mode,
        cc_emails,
        bcc_emails,
        internal_is_enabled,
        internal_schedule_type,
        internal_weekly_days,
        internal_monthly_days,
        internal_monthly_mode,
        send_hour,
        send_minute,
        internal_send_hour,
        internal_send_minute,
        timezone,
        last_sent_at,
        last_internal_sent_at
      `)
      .eq("project_id", PROJECT_ID)
      .maybeSingle();
  
    if (error) {
      showHint("Failed to load project email settings.", true);
      return;
    }
  
    const row = data || {};
    emailHistoryLastSent = {
      client: row.last_sent_at || null,
      internal: row.last_internal_sent_at || null,
    };
    syncClientUpdateForm(row);
    syncInternalUpdateForm({
      is_enabled: row.internal_is_enabled,
      schedule_type: row.internal_schedule_type,
      weekly_days: row.internal_weekly_days,
      monthly_days: row.internal_monthly_days,
      monthly_mode: row.internal_monthly_mode,
      send_hour: row.internal_send_hour,
      send_minute: row.internal_send_minute,
      timezone: row.timezone,
    });
    renderEmailRunHistory();
  }
  
  function addEmailToList(inputId, targetKey) {
    const input = el(inputId);
    const value = String(input?.value || "").trim().toLowerCase();
    if (!isValidEmail(value)) {
      showHint("Please enter a valid email address.", true);
      return;
    }
    clientUpdateSettings[targetKey] = normalizeEmailList([...(clientUpdateSettings[targetKey] || []), value]);
    input.value = "";
    renderEmailLists();
    renderClientUpdateSummary();
    clearHint();
  }
  
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-email]");
    if (!btn) return;
    const email = btn.getAttribute("data-remove-email");
    const kind = btn.getAttribute("data-remove-kind");
    if (kind === "audit") clientUpdateSettings.audit_emails = (clientUpdateSettings.audit_emails || []).filter((value) => value !== email);
    renderEmailLists();
    renderClientUpdateSummary();
  });
  
  document.querySelectorAll("[data-update-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-update-type") || "weekly";
      setSegmentedType("[data-update-type]", type);
      toggleScheduleGroups(false, type);
      renderClientUpdateSummary();
      clearHint();
    });
  });
  
  document.querySelectorAll("[data-internal-update-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-internal-update-type") || "weekly";
      setSegmentedType("[data-internal-update-type]", type);
      toggleScheduleGroups(true, type);
      renderInternalUpdateSummary();
      clearHint();
    });
  });
  
  document.querySelectorAll("[data-weekday], [data-internal-weekday]").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      renderClientUpdateSummary();
      renderInternalUpdateSummary();
      clearHint();
    });
  });
  
  document.querySelectorAll("[data-monthday]").forEach((chip) => {
    chip.textContent = ordinalDayLabel(chip.getAttribute("data-monthday"));
    chip.addEventListener("click", () => {
      const isActive = chip.classList.contains("active");
      const selected = [...document.querySelectorAll("[data-monthday].active")];
      if (!isActive && selected.length >= 2) {
        showHint("Monthly schedule supports up to 2 send dates.", true);
        return;
      }
      chip.classList.toggle("active");
      renderClientUpdateSummary();
      clearHint();
    });
  });
  
  initTimePickers();
  
  el("projectUpdateEnabled").addEventListener("change", () => {
    renderClientUpdateSummary();
    clearHint();
  });
  el("internalUpdateEnabled").addEventListener("change", () => {
    renderInternalUpdateSummary();
    clearHint();
  });
  el("projectUpdateTimeInput").addEventListener("input", () => {
    renderClientUpdateSummary();
    clearHint();
  });
  el("internalUpdateTimeInput").addEventListener("input", () => {
    renderInternalUpdateSummary();
    clearHint();
  });
  el("clientAuditAddBtn").addEventListener("click", () => addEmailToList("clientAuditInput", "audit_emails"));
  el("clientAuditInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addEmailToList("clientAuditInput", "audit_emails"); } });
  
  el("saveProjectUpdateBtn").addEventListener("click", async () => {
    const validation = validateProjectUpdateSchedule(getClientScheduleState());
    if (!validation.ok) {
      showHint(validation.message, true);
      return;
    }
  
    const payload = {
      project_id: PROJECT_ID,
      is_enabled: validation.settings.is_enabled,
      schedule_type: validation.settings.schedule_type,
      weekly_days: validation.settings.schedule_type === "weekly" ? validation.settings.weekly_days : [],
      monthly_days: validation.settings.schedule_type === "monthly" ? validation.settings.monthly_days : [],
      monthly_mode: validation.settings.schedule_type === "monthly" ? validation.settings.monthly_mode : "dates",
      send_hour: validation.settings.send_hour,
      send_minute: validation.settings.send_minute,
      cc_emails: normalizeEmailList(clientUpdateSettings.audit_emails),
      bcc_emails: [],
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    };
  
    el("saveProjectUpdateBtn").disabled = true;
    el("saveProjectUpdateBtn").textContent = "Saving...";
  
    const { error } = await supabase.from("project_update_email_settings").upsert(payload, { onConflict: "project_id" });
  
    el("saveProjectUpdateBtn").disabled = false;
    el("saveProjectUpdateBtn").textContent = "Save Client Schedule";
  
    if (error) {
      showHint("Failed to save client email settings: " + error.message, true);
      return;
    }
  
    syncClientUpdateForm(payload);
    showHint("Client email schedule saved.", false);
  });
  
  el("saveInternalUpdateBtn").addEventListener("click", async () => {
    const validation = validateProjectUpdateSchedule(getInternalScheduleState());
    if (!validation.ok) {
      showHint(validation.message, true);
      return;
    }
  
    const targetProjectIds = internalPortfolioProjects.map((project) => project.id);
    if (!targetProjectIds.length) {
      showHint("No active projects found for the internal portfolio summary.", true);
      return;
    }
  
    const payload = targetProjectIds.map((projectId) => ({
      project_id: projectId,
      internal_is_enabled: validation.settings.is_enabled,
      internal_schedule_type: validation.settings.schedule_type,
      internal_weekly_days: validation.settings.schedule_type === "weekly" ? validation.settings.weekly_days : [],
      internal_monthly_days: validation.settings.schedule_type === "monthly" ? validation.settings.monthly_days : [],
      internal_monthly_mode: validation.settings.schedule_type === "monthly" ? validation.settings.monthly_mode : "dates",
      internal_send_hour: validation.settings.send_hour,
      internal_send_minute: validation.settings.send_minute,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    }));
  
    el("saveInternalUpdateBtn").disabled = true;
    el("saveInternalUpdateBtn").textContent = "Saving...";
  
    const { error } = await supabase.from("project_update_email_settings").upsert(payload, { onConflict: "project_id" });
  
    el("saveInternalUpdateBtn").disabled = false;
    el("saveInternalUpdateBtn").textContent = "Save Internal Schedule";
  
    if (error) {
      showHint("Failed to save internal email settings: " + error.message, true);
      return;
    }
  
    syncInternalUpdateForm({
      is_enabled: validation.settings.is_enabled,
      schedule_type: validation.settings.schedule_type,
      weekly_days: validation.settings.weekly_days,
      monthly_days: validation.settings.monthly_days,
      monthly_mode: validation.settings.monthly_mode,
      send_hour: validation.settings.send_hour,
      send_minute: validation.settings.send_minute,
      timezone: "Asia/Bangkok",
    });
    await loadInternalPortfolioContext();
    showHint(`Internal email schedule saved for ${payload.length} active project(s).`, false);
  });
  
  async function sendEmailReportNow(recipientGroup, buttonId, idleText) {
    const button = el(buttonId);
    button.disabled = true;
    button.textContent = "Sending...";
  
    let data = null;
    let error = null;
    try {
      ({ data, error } = await supabase.functions.invoke("project-update-summary", {
        body: { projectId: PROJECT_ID, source: "manual", recipientGroup },
      }));
    } catch (err) {
      error = err;
    } finally {
      button.disabled = false;
      button.textContent = idleText;
    }
  
    if (error) {
      await loadEmailRunHistory();
      showHint("Failed to send project update email: " + await getFunctionErrorMessage(error), true);
      return;
    }
  
    await loadProjectUpdateSettings();
    await loadEmailRunHistory();
  
    const sentResult = Array.isArray(data?.results)
      ? data.results.find((result) => result?.status === "sent")
      : null;
    if (sentResult?.status === "sent") {
      const recipientCount = Array.isArray(sentResult.sent_to) ? sentResult.sent_to.length : 0;
      const projectCount = Number(sentResult.project_count || 0);
      showHint(
        recipientGroup === "internal"
          ? `Internal report sent to ${recipientCount} recipient(s) across ${projectCount || 1} active project(s).`
          : `Client report sent to ${recipientCount} recipient(s).`,
          false,
        );
      if (recipientGroup === "internal") await loadInternalPortfolioContext();
      return;
    }
  
    showHint("Project update request completed, but no email was sent.", false);
  }
  
  el("sendProjectUpdateNowBtn").addEventListener("click", async () => {
    const validation = validateProjectUpdateSchedule({
      ...getClientScheduleState(),
      is_enabled: true,
    });
    if (!validation.ok) {
      showHint(validation.message, true);
      return;
    }
    await sendEmailReportNow("client", "sendProjectUpdateNowBtn", "Send Report Now");
  });
  
  el("sendInternalUpdateNowBtn").addEventListener("click", async () => {
    const validation = validateProjectUpdateSchedule({
      ...getInternalScheduleState(),
      is_enabled: true,
    });
    if (!validation.ok) {
      showHint(validation.message, true);
      return;
    }
    await sendEmailReportNow("internal", "sendInternalUpdateNowBtn", "Send Internal Report Now");
  });
  
  el("toggleEmailHistoryBtn").addEventListener("click", () => {
    const panel = el("emailHistoryPanel");
    const button = el("toggleEmailHistoryBtn");
    const expanded = !panel.classList.contains("expanded");
    panel.classList.toggle("expanded", expanded);
    button.setAttribute("aria-expanded", String(expanded));
  });
  
  el("refreshEmailHistoryBtn").addEventListener("click", async () => {
    const button = el("refreshEmailHistoryBtn");
    button.disabled = true;
    button.textContent = "Refreshing...";
    await Promise.all([loadProjectUpdateSettings(), loadEmailRunHistory()]);
    button.disabled = false;
    button.textContent = "Refresh History";
  });

  return {
    loadProjectUpdateSettings,
    loadEmailRunHistory,
    loadInternalPortfolioContext,
    renderProjectUpdateRecipients,
  };
}
