import { createProjectSettingsContext } from "./context.js";
import { createAuthSidebarController } from "./auth-sidebar.js";
import { createProjectDetailsController } from "./project-details.js";
import { createEmailScheduleController } from "./email-schedule.js";
import { createAvailabilityController } from "./availability.js";
import { createFieldsController } from "./fields.js";
import { createMembersController } from "./members.js";
import { createParticipantImportController } from "./participant-import.js";

const ctx = createProjectSettingsContext();

try {
  ctx.controllers.auth = createAuthSidebarController(ctx);
  const session = await ctx.controllers.auth.requireProjectSettingsAccess();
  if (!session) throw new Error("no access");
  ctx.session = session;

  ctx.controllers.auth.bindSidebar();
  ctx.controllers.auth.bindTabs();
  await ctx.controllers.auth.refreshTicketBadge();

  ctx.controllers.projectDetails = createProjectDetailsController(ctx);
  ctx.controllers.email = createEmailScheduleController(ctx);
  ctx.controllers.availability = createAvailabilityController(ctx);
  ctx.controllers.fields = createFieldsController(ctx);
  ctx.controllers.members = createMembersController(ctx);
  ctx.controllers.participantImport = createParticipantImportController(ctx);

  await Promise.all([
    ctx.controllers.projectDetails.loadProject(),
    ctx.controllers.members.loadMembers(),
    ctx.controllers.members.loadAllProfiles(),
    ctx.controllers.email.loadProjectUpdateSettings(),
    ctx.controllers.email.loadEmailRunHistory(),
    ctx.controllers.email.loadInternalPortfolioContext(),
  ]);
  await ctx.controllers.fields.loadFields();
  await ctx.controllers.fields.loadFieldLibrary();
  await ctx.controllers.availability.loadAvailabilityStepSettings();
  await Promise.all([
    ctx.controllers.availability.loadAvailabilityConsultants(),
    ctx.controllers.availability.loadAvailabilitySlots(),
  ]);
} finally {
  ctx.hidePageSkeleton();
}
