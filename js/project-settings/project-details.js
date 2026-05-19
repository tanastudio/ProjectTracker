export function createProjectDetailsController(ctx) {
  const { supabase, el, PROJECT_ID, showHint } = ctx;
  let loadedCodePrefix = "";

  async function loadProject() {
    const { data, error } = await supabase.from("projects").select("*").eq("id", PROJECT_ID).single();
    if (error || !data) { showHint("Failed to load project.", true); return; }
    el("pageHeading").textContent = data.name + " - Settings";
    el("pageDesc").textContent = "Project ID: " + PROJECT_ID;
    el("projName").value       = data.name         || "";
    el("projDesc").value       = data.description  || "";
    el("projStart").value      = data.start_date   || "";
    el("projEnd").value        = data.end_date     || "";
    el("projStatus").value     = data.status       || "active";
    el("projCodePrefix").value = data.code_prefix  || "";
    loadedCodePrefix = data.code_prefix || "";
    el("projRelatedInvoiceNumber").value = data.related_invoice_number || "";
  }
  
  el("archiveBtn").addEventListener("click", async () => {
    if (!confirm("Archive this project? It will be hidden from the project list. You can restore it later by setting the status back to Active.")) return;
    el("archiveBtn").disabled    = true;
    el("archiveBtn").textContent = "Archiving...";
    const { error } = await supabase.from("projects").update({ status: "archived" }).eq("id", PROJECT_ID);
    el("archiveBtn").disabled    = false;
    el("archiveBtn").textContent = "Archive Project";
    if (error) { showHint("Error: " + error.message, true); return; }
    window.location.href = "./projects.html";
  });
  
  el("saveGeneralBtn").addEventListener("click", async () => {
    const name = el("projName").value.trim();
    const nextCodePrefix = el("projCodePrefix").value.trim();
    if (!name) { showHint("Project name is required.", true); return; }
    if (String(nextCodePrefix || "") !== String(loadedCodePrefix || "")) {
      const ok = confirm("Changing the project code prefix only affects new participants. Existing participant codes will not be regenerated.");
      if (!ok) return;
    }
    el("saveGeneralBtn").disabled    = true;
    el("saveGeneralBtn").textContent = "Saving...";
    const { error } = await supabase.from("projects").update({
      name,
      description:  el("projDesc").value.trim() || null,
      status:       el("projStatus").value,
      start_date:   el("projStart").value || null,
      end_date:     el("projEnd").value   || null,
      code_prefix:  nextCodePrefix || null,
      related_invoice_number: el("projRelatedInvoiceNumber").value.trim() || null,
    }).eq("id", PROJECT_ID);
    el("saveGeneralBtn").disabled    = false;
    el("saveGeneralBtn").textContent = "Save Changes";
    if (error) { showHint("Error: " + error.message, true); return; }
    el("pageHeading").textContent = name + " - Settings";
    loadedCodePrefix = nextCodePrefix;
    showHint("Project info updated.", false);
  });

  return {
    loadProject,
  };
}
