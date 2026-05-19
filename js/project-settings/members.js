export function createMembersController(ctx) {
  const { supabase, el, PROJECT_ID, showHint, clearHint, escapeHtml } = ctx;
  const session = ctx.session;
  const members = ctx.state.members;

  let selectedResetMember = null;
  let allProfiles = []; // { id, display_name, role } - admin/internal/client only
  
  function getMemberResetRows() {
    const filters = new Set(
      [...document.querySelectorAll("[data-reset-filter]:checked")]
        .map(input => String(input.getAttribute("data-reset-filter") || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const term = String(el("resetPasswordSearch")?.value || "").trim().toLowerCase();
  
    return members
      .map((member) => {
        const profile = member.profile || {};
        return {
          userId: member.user_id,
          name: profile.display_name || member.user_id,
          email: profile.email || "",
          role: String(profile.role || "").trim().toLowerCase(),
        };
      })
      .filter((row) => filters.has(row.role))
      .filter((row) => {
        if (!term) return true;
        return row.name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term);
      })
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  }
  
  function readDirectPasswordResetForm() {
    const password = String(el("setNewPassword")?.value || "");
    const confirmPassword = String(el("setConfirmPassword")?.value || "");
    if (password.length < 8) {
      return { error: "New password must be at least 8 characters." };
    }
    if (password !== confirmPassword) {
      return { error: "Password confirmation does not match." };
    }
    return { password };
  }
  
  function setPasswordModalFeedback(text = "", isErr = false) {
    const box = el("setPasswordFeedback");
    if (!box) return;
    box.textContent = text;
    box.className = "modal-feedback" + (text ? (isErr ? " error" : " ok") : "");
  }
  
  async function formatFunctionError(error) {
    const status = error?.context?.status;
    const statusText = error?.context?.statusText;
    const lines = [`Message: ${error?.message || "Unknown error"}`];
    if (status) lines.push(`Status: ${status}${statusText ? ` ${statusText}` : ""}`);
  
    if (error?.context) {
      try {
        const payload = await error.context.clone().json();
        if (payload?.error) lines.push(`Detail: ${payload.error}`);
        else lines.push(`Response: ${JSON.stringify(payload)}`);
      } catch {
        try {
          const text = await error.context.clone().text();
          if (text) lines.push(`Response: ${text}`);
        } catch {
          // Ignore unreadable response bodies.
        }
      }
    }
  
    if (status === 404) {
      lines.push("Debug: admin-reset-password was not found on the active Supabase endpoint. Restart the local Supabase stack or deploy the function to this endpoint.");
    }
    return lines.join("\n");
  }
  
  function openSetPasswordModal(row) {
    selectedResetMember = row;
    el("setPasswordTarget").innerHTML = `
      <div class="reset-target-name">${escapeHtml(row?.name || "Selected member")}</div>
      <div class="reset-target-meta">${escapeHtml(row?.email || "No email in profile")} · ${escapeHtml(row?.role || "-")}</div>
    `;
    el("setNewPassword").value = "";
    el("setConfirmPassword").value = "";
    setPasswordModalFeedback("");
    const modal = el("setPasswordModal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    el("setNewPassword")?.focus();
  }
  
  function closeSetPasswordModal() {
    const modal = el("setPasswordModal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    el("setNewPassword").value = "";
    el("setConfirmPassword").value = "";
    setPasswordModalFeedback("");
    selectedResetMember = null;
  }
  
  async function submitSelectedPasswordReset() {
    if (!selectedResetMember?.userId) {
      setPasswordModalFeedback("No member selected.", true);
      return;
    }
    const form = readDirectPasswordResetForm();
    if (form.error) {
      setPasswordModalFeedback(form.error, true);
      return;
    }
  
    const button = el("submitSetPasswordBtn");
    button.disabled = true;
    button.textContent = "Saving...";
    setPasswordModalFeedback("Calling admin-reset-password...", false);
  
    const { error } = await supabase.functions.invoke("admin-reset-password", {
      body: {
        project_id: PROJECT_ID,
        user_id: selectedResetMember.userId,
        password: form.password,
      },
    });
  
    button.disabled = false;
    button.textContent = "Set Password";
    if (error) {
      setPasswordModalFeedback(await formatFunctionError(error), true);
      return;
    }
  
    const successTarget = selectedResetMember.email || selectedResetMember.name || "selected member";
    closeSetPasswordModal();
    showHint(`Password updated for ${successTarget}. They will be asked to change it after signing in.`, false);
  }
  
  function renderResetPasswordList() {
    const list = el("resetPasswordList");
    if (!list) return;
    const rows = getMemberResetRows();
    if (!rows.length) {
      list.innerHTML = "<div class='muted'>No project members match the filters.</div>";
      return;
    }
  
    list.innerHTML = rows.map((row) => `
      <div class="reset-row" data-reset-user-id="${escapeHtml(row.userId)}">
        <div><span class="pill pill-${escapeHtml(row.role)}">${escapeHtml(row.role || "-")}</span></div>
        <div class="reset-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
        <div class="reset-email" title="${escapeHtml(row.email || "No email in profile")}">${escapeHtml(row.email || "No email in profile")}</div>
        <button class="btn-ghost" type="button" data-reset-member-id="${escapeHtml(row.userId)}">Reset Password</button>
      </div>
    `).join("");
  
    list.querySelectorAll("[data-reset-member-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const userId = String(button.getAttribute("data-reset-member-id") || "").trim();
        const row = getMemberResetRows().find(item => item.userId === userId);
        if (!row) return;
        openSetPasswordModal(row);
      });
    });
  }
  
  function openResetPasswordModal() {
    renderResetPasswordList();
    const modal = el("resetPasswordModal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    el("resetPasswordSearch")?.focus();
  }
  
  function closeResetPasswordModal() {
    const modal = el("resetPasswordModal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    closeSetPasswordModal();
  }
  
  function getActiveMemberFilters() {
    return new Set(
      [...document.querySelectorAll("[data-member-filter]:checked")]
        .map(input => String(input.getAttribute("data-member-filter") || "").trim().toLowerCase())
        .filter(Boolean)
    );
  }
  
  function getFilteredMembers() {
    const filters = getActiveMemberFilters();
    return members.filter((m) => {
      const profileRole = String(m?.profile?.role || "").trim().toLowerCase();
      return filters.has(profileRole);
    });
  }
  
  function updateMemberSummary(filteredMembers) {
    const summary = el("memberSummary");
    if (!summary) return;
    const visible = Array.isArray(filteredMembers) ? filteredMembers.length : 0;
    const total = members.length;
    summary.textContent = total === visible ? `${total} member${total !== 1 ? "s" : ""}` : `Showing ${visible} of ${total} members`;
  }

  function canManageProjectMembers() {
    return ctx.state.currentProfileRole === "admin";
  }

  function syncMemberManagementAccess() {
    const panel = el("memberManagementPanel");
    if (panel) panel.style.display = canManageProjectMembers() ? "" : "none";
  }

  function normalizeProjectMember(row) {
    const userId = row?.user_id || row?.id || "";
    return {
      user_id: userId,
      role: row?.member_role || row?.role || "viewer",
      profile: {
        id: userId,
        display_name: row?.display_name || "",
        email: row?.email || "",
        role: row?.profile_role || row?.user_role || "",
        participant_record_id: row?.participant_record_id || null,
        participant_active: row?.participant_active,
      },
    };
  }

  function renderMemberAccessControl(member) {
    const access = member.role || "viewer";
    return `
      <select class="member-role-select" data-role-uid="${escapeHtml(member.user_id)}">
        <option value="viewer" ${access === "viewer" ? "selected" : ""}>viewer</option>
        <option value="editor" ${access === "editor" ? "selected" : ""}>editor</option>
      </select>
    `;
  }

  async function loadMembers() {
    const { data: rpcRows, error: rpcError } = await supabase.rpc("get_project_members_for_settings", { p_project_id: PROJECT_ID });
    if (!rpcError && Array.isArray(rpcRows)) {
      members.splice(0, members.length, ...rpcRows.map(normalizeProjectMember));
      renderMembers();
      ctx.controllers.email?.renderProjectUpdateRecipients?.();
      renderResetPasswordList();
      return;
    }
    if (rpcError) console.warn("Falling back to project_members query:", rpcError);

    const { data, error } = await supabase
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", PROJECT_ID);
    if (error) { showHint("Failed to load members.", true); return; }
    members.splice(0, members.length, ...(data || []));
  
    // Load profile info for each member
    if (members.length > 0) {
      const ids = members.map(m => m.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, email, role")
        .in("id", ids);
      const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
      members.splice(0, members.length, ...members.map(m => ({ ...m, profile: profMap[m.user_id] || null })));
    }
  
    renderMembers();
    ctx.controllers.email?.renderProjectUpdateRecipients?.();
    renderResetPasswordList();
  }

  async function loadAllProfiles() {
    syncMemberManagementAccess();
    if (!canManageProjectMembers()) {
      allProfiles = [];
      refreshAddMemberSelect();
      ctx.controllers.email?.renderProjectUpdateRecipients?.();
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, email, role")
      .in("role", ["admin", "internal", "client"])
      .order("role");
    allProfiles = data || [];
    refreshAddMemberSelect();
    ctx.controllers.email?.renderProjectUpdateRecipients?.();
  }
  
  function renderMembers() {
    const list = el("memberList");
    const canManage = canManageProjectMembers();
    syncMemberManagementAccess();

    if (members.length === 0) {
      list.innerHTML = "<div class='muted'>No members yet.</div>";
      updateMemberSummary([]);
      refreshAddMemberSelect();
      return;
    }
  
    const filteredMembers = getFilteredMembers();
    updateMemberSummary(filteredMembers);
  
    if (filteredMembers.length === 0) {
      list.innerHTML = "<div class='muted'>No members match the selected filters.</div>";
      refreshAddMemberSelect();
      return;
    }
  
    const rowsHtml = filteredMembers.map(m => {
      const p    = m.profile || {};
      const name = p.display_name || m.user_id;
      const role = p.role || "";
      const email = p.email || m.email || m.user_email || m.user_id;
      return `
        <div class="member-row ${canManage ? "" : "member-readonly"}" data-uid="${escapeHtml(m.user_id)}" role="row">
          <div class="member-role-cell" role="cell">
            <span class="pill pill-${escapeHtml(role)}">${escapeHtml(role || "-")}</span>
          </div>
          <div class="member-name" role="cell" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="member-email" role="cell" title="${escapeHtml(email)}">${escapeHtml(email)}</div>
          ${canManage ? `
            <div class="member-access-cell" role="cell">
              ${renderMemberAccessControl(m)}
            </div>
            <button class="btn-danger-sm" data-remove-uid="${escapeHtml(m.user_id)}" type="button">Remove</button>
          ` : ""}
        </div>`;
    }).join("");

    list.innerHTML = `
      <div class="member-table-head ${canManage ? "" : "member-readonly"}" role="row">
        <div>Role</div>
        <div>Name</div>
        <div>Email</div>
        ${canManage ? "<div>Access</div><div>Remove</div>" : ""}
      </div>
      ${rowsHtml}
    `;

    if (!canManage) {
      refreshAddMemberSelect();
      return;
    }

    list.querySelectorAll("[data-role-uid]").forEach(sel => {
      sel.addEventListener("change", async () => {
        const uid = sel.dataset.roleUid;
        const { error } = await supabase.from("project_members")
          .update({ role: sel.value })
          .match({ user_id: uid, project_id: PROJECT_ID });
        if (error) {
          showHint("Failed to update role.", true);
          sel.value = members.find(m => m.user_id === uid)?.role || "viewer";
        } else {
          members.find(m => m.user_id === uid).role = sel.value;
          showHint("Role updated.", false);
        }
      });
    });
  
    list.querySelectorAll("[data-remove-uid]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.removeUid;
        if (!confirm("Remove this member from the project?")) return;
        const { error } = await supabase.from("project_members")
          .delete().match({ user_id: uid, project_id: PROJECT_ID });
        if (error) { showHint("Failed to remove member.", true); return; }
        showHint("Member removed.", false);
        await loadMembers();
      });
    });
  
    refreshAddMemberSelect();
  }
  
  document.querySelectorAll("[data-member-filter]").forEach((input) => {
    input.addEventListener("change", () => {
      renderMembers();
      clearHint();
    });
  });
  
  el("openResetPasswordBtn").addEventListener("click", openResetPasswordModal);
  el("closeResetPasswordBtn").addEventListener("click", closeResetPasswordModal);
  el("resetPasswordModal").addEventListener("click", (event) => {
    if (event.target === el("resetPasswordModal")) closeResetPasswordModal();
  });
  el("closeSetPasswordBtn").addEventListener("click", closeSetPasswordModal);
  el("setPasswordModal").addEventListener("click", (event) => {
    if (event.target === el("setPasswordModal")) closeSetPasswordModal();
  });
  el("submitSetPasswordBtn").addEventListener("click", submitSelectedPasswordReset);
  ["setNewPassword", "setConfirmPassword"].forEach((id) => {
    el(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSelectedPasswordReset();
      }
    });
  });
  el("resetPasswordSearch").addEventListener("input", renderResetPasswordList);
  document.querySelectorAll("[data-reset-filter]").forEach((input) => {
    input.addEventListener("change", renderResetPasswordList);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el("confirmDialog")?.classList.contains("open")) {
      closeConfirmDialog(false);
      return;
    }
    if (event.key === "Escape" && el("setPasswordModal")?.classList.contains("open")) {
      closeSetPasswordModal();
      return;
    }
    if (event.key === "Escape" && el("resetPasswordModal")?.classList.contains("open")) {
      closeResetPasswordModal();
    }
  });

  el("confirmDialogConfirm")?.addEventListener("click", () => closeConfirmDialog(true));
  el("confirmDialogCancel")?.addEventListener("click", () => closeConfirmDialog(false));
  el("confirmDialogClose")?.addEventListener("click", () => closeConfirmDialog(false));
  el("confirmDialog")?.addEventListener("click", (event) => {
    if (event.target === el("confirmDialog")) closeConfirmDialog(false);
  });

  function refreshAddMemberSelect() {
    const sel      = el("addMemberSelect");
    if (!sel || !canManageProjectMembers()) return;
    const existing = new Set(members.map(m => m.user_id));
    const available = allProfiles.filter(p => !existing.has(p.id));
    sel.innerHTML = available.length
      ? `<option value="">Select a user to add...</option>` +
        available.map(p =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.display_name || p.id)}${p.email ? ` - ${escapeHtml(p.email)}` : ""} (${escapeHtml(p.role)})</option>`
        ).join("")
      : `<option value="">All eligible users already added</option>`;
  }

  el("addMemberBtn").addEventListener("click", async () => {
    if (!canManageProjectMembers()) return;
    const uid = el("addMemberSelect").value;
    if (!uid) { showHint("Select a user to add.", true); return; }
    const role = el("addMemberRole").value;
    const { error } = await supabase.from("project_members")
      .upsert({ user_id: uid, project_id: PROJECT_ID, role }, { onConflict: "user_id,project_id" });
    if (error) { showHint("Failed to add member: " + error.message, true); return; }
    showHint("Member added.", false);
    await loadMembers();
  });
  
  return {
    loadMembers,
    loadAllProfiles,
    renderMembers,
    renderResetPasswordList,
    normalizeProjectMember,
  };
}
