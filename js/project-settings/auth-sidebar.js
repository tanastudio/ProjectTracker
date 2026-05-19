import { getProjectSettingsAccessDecision } from "../../lib/access-control-utils.js";
import { attachTicketNavBadge } from "../../lib/ticket-nav-badge.js";

export function createAuthSidebarController(ctx) {
  const { supabase, el, PROJECT_ID, clearHint } = ctx;

  async function requireProjectSettingsAccess() {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session) {
      window.location.replace("./index.html");
      return null;
    }

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) window.location.replace("./index.html");
    });

    const [{ data: prof }, { data: project }, { data: member }] = await Promise.all([
      supabase.from("profiles").select("role, display_name").eq("id", session.user.id).maybeSingle(),
      supabase.from("projects").select("id, created_by").eq("id", PROJECT_ID).maybeSingle(),
      supabase.from("project_members").select("role").eq("project_id", PROJECT_ID).eq("user_id", session.user.id).maybeSingle(),
    ]);

    const role = String(prof?.role || session.user.user_metadata?.role || "").trim().toLowerCase();
    const memberRole = String(member?.role || "").trim().toLowerCase();
    const access = getProjectSettingsAccessDecision({
      profileRole: role,
      memberRole,
      projectCreatedBy: project?.created_by,
      userId: session.user.id,
    });

    if (!access.ok) {
      window.location.replace(access.redirectTo);
      return null;
    }

    ctx.state.currentProfileRole = role || "viewer";
    sessionStorage.setItem("user_role", ctx.state.currentProfileRole);
    document.documentElement.setAttribute("data-user-role", ctx.state.currentProfileRole);
    const chip = el("userChip");
    if (chip) chip.textContent = (prof?.display_name || session.user.email || session.user.id) + " (" + ctx.state.currentProfileRole + ")";
    return session;
  }

  function goProjectPage(page) {
    window.location.href = "./" + page + "?project=" + encodeURIComponent(PROJECT_ID);
  }

  function bindSidebar() {
    el("logoutBtn")?.addEventListener("click", async () => {
      await supabase.auth.signOut();
      sessionStorage.removeItem("selected_project_id");
      window.location.replace("./index.html");
    });

    el("navDashboard")?.addEventListener("click", (event) => { event.preventDefault(); goProjectPage("dashboard.html"); });
    el("navTickets")?.addEventListener("click", (event) => { event.preventDefault(); goProjectPage("tickets.html"); });
    el("navUpdateStatus")?.addEventListener("click", (event) => { event.preventDefault(); goProjectPage("form.html"); });
    el("navProjectSettings")?.addEventListener("click", (event) => { event.preventDefault(); goProjectPage("project-settings.html"); });
    el("navAdmin")?.addEventListener("click", (event) => { event.preventDefault(); goProjectPage("admin.html"); });
    el("backBtn")?.addEventListener("click", () => { window.location.href = "./projects.html"; });
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
        btn.classList.add("active");
        el("tab-" + btn.dataset.tab).classList.add("active");
        clearHint();
      });
    });

    document.querySelectorAll(".subtab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const shell = btn.closest(".report-shell");
        if (!shell) return;
        shell.querySelectorAll(".subtab-btn").forEach((button) => button.classList.remove("active"));
        shell.querySelectorAll(".subtab-panel").forEach((panel) => panel.classList.remove("active"));
        btn.classList.add("active");
        el("subtab-" + btn.dataset.subtab).classList.add("active");
        clearHint();
      });
    });
  }

  async function refreshTicketBadge() {
    const session = ctx.session;
    if (!session?.user?.id) return;
    const ticketNavBadge = attachTicketNavBadge({
      supabase,
      navElement: document.getElementById("navTickets"),
      getProjectId: () => PROJECT_ID || "",
      userId: session.user.id,
      displayMode: "unread_only",
    });
    await ticketNavBadge.refresh();
  }

  return {
    requireProjectSettingsAccess,
    bindSidebar,
    bindTabs,
    refreshTicketBadge,
  };
}
