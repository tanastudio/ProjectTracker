// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeProjectUpdateSchedule } from "../../../lib/project-update-email-utils.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-project-update-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ProjectSettingsRow = {
  project_id: string;
  is_enabled: boolean;
  schedule_type: "weekly" | "monthly";
  weekly_days: number[];
  monthly_days: number[];
  monthly_mode: "dates" | "end_of_month";
  cc_emails: string[];
  bcc_emails: string[];
  internal_is_enabled: boolean;
  internal_schedule_type: "weekly" | "monthly";
  internal_weekly_days: number[];
  internal_monthly_days: number[];
  internal_monthly_mode: "dates" | "end_of_month";
  send_hour: number;
  send_minute: number;
  internal_send_hour: number;
  internal_send_minute: number;
  timezone: string;
  last_sent_at: string | null;
  last_internal_sent_at: string | null;
  project_name?: string;
};

type RecipientGroup = "client" | "internal";

type DeliveryChannel = {
  project_id: string;
  recipient_group: RecipientGroup;
  is_enabled: boolean;
  schedule_type: "weekly" | "monthly";
  weekly_days: number[];
  monthly_days: number[];
  monthly_mode: "dates" | "end_of_month";
  send_hour: number;
  send_minute: number;
  timezone: string;
  audit_emails: string[];
};

type ProjectSummary = {
  totalParticipants: number;
  overallCounts: Record<string, number>;
  processRows: Array<{
    key: string;
    label: string;
    counts: Record<string, number>;
    total: number;
  }>;
};

type ProjectEmailSection = {
  projectId: string;
  projectName: string;
  dashboardUrl: string;
  summary: ProjectSummary;
};

type AuthorizedUser = {
  id: string;
  role: string;
};

const STATUS_ORDER = ["Completed", "In Progress", "Issue", "Not Started"];
const STATUS_COLORS: Record<string, string> = {
  "Completed": "#22c55e",
  "In Progress": "#3b82f6",
  "Issue": "#ef4444",
  "Not Started": "#f59e0b",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildDebugInfo(supabaseUrl: string, webhookUrl: string, requestedByCron: boolean) {
  if (requestedByCron) return null;

  try {
    const parsed = new URL(webhookUrl);
    return {
      supabase_url: supabaseUrl,
      webhook_url: webhookUrl,
      webhook_host: parsed.host,
      webhook_path: parsed.pathname,
    };
  } catch {
    return {
      webhook_url: webhookUrl,
      webhook_host: "",
      webhook_path: "",
    };
  }
}

function pickValue(row: Record<string, unknown>): string {
  const valueText = row.value_text;
  const valueSelect = row.value_select;
  if (typeof valueText === "string" && valueText.trim()) return valueText.trim();
  if (typeof valueSelect === "string" && valueSelect.trim()) return valueSelect.trim();
  return "";
}

function normalizeStatus(value: unknown): string {
  const text = String(value ?? "").trim();
  return STATUS_ORDER.includes(text) ? text : "Not Started";
}

function computeOverall(stepStatuses: string[]): string {
  if (stepStatuses.length === 0) return "Not Started";
  if (stepStatuses.some((status) => status === "Issue")) return "Issue";
  if (stepStatuses.every((status) => status === "Completed")) return "Completed";
  if (stepStatuses.some((status) => status === "In Progress")) return "In Progress";
  if (stepStatuses.some((status) => status === "Completed")) return "In Progress";
  return "Not Started";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isDeliverableEmail(email: string): boolean {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith("@example.com")) return false;
  return true;
}

function normalizeEmailList(emails: string[]) {
  return [...new Set((emails || []).map((email) => String(email || "").trim().toLowerCase()).filter(isDeliverableEmail))];
}

function getZonedParts(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfMonth: Number(parts.day),
    isoWeekday: weekdayMap[String(parts.weekday)] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isLastDayOfMonth(dateKey: string, timezone: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return false;

  const nextUtc = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  const nextParts = getZonedParts(nextUtc, timezone);
  return nextParts.dayOfMonth === 1;
}

function formatReportDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "/");
}

function shouldRunSchedule(settings: DeliveryChannel, now: Date) {
  if (!settings.is_enabled) return { due: false, localDate: null as string | null };

  const zoned = getZonedParts(now, settings.timezone || "Asia/Bangkok");
  if (zoned.hour !== Number(settings.send_hour ?? 9)) {
    return { due: false, localDate: zoned.dateKey };
  }
  if (zoned.minute !== Number(settings.send_minute ?? 0)) {
    return { due: false, localDate: zoned.dateKey };
  }

  if (settings.schedule_type === "monthly") {
    if (settings.monthly_mode === "end_of_month") {
      return {
        due: isLastDayOfMonth(zoned.dateKey, settings.timezone || "Asia/Bangkok"),
        localDate: zoned.dateKey,
      };
    }
    return {
      due: settings.monthly_days.includes(zoned.dayOfMonth),
      localDate: zoned.dateKey,
    };
  }

  return {
    due: settings.weekly_days.includes(zoned.isoWeekday),
    localDate: zoned.dateKey,
  };
}

function buildChannels(row: ProjectSettingsRow): DeliveryChannel[] {
  return [
    {
      project_id: row.project_id,
      recipient_group: "client",
      is_enabled: row.is_enabled,
      schedule_type: row.schedule_type,
      weekly_days: row.weekly_days,
      monthly_days: row.monthly_days,
      monthly_mode: row.monthly_mode,
      send_hour: row.send_hour,
      send_minute: row.send_minute,
      timezone: row.timezone,
      audit_emails: normalizeEmailList([...(row.cc_emails || []), ...(row.bcc_emails || [])]),
    },
    {
      project_id: row.project_id,
      recipient_group: "internal",
      is_enabled: row.internal_is_enabled,
      schedule_type: row.internal_schedule_type,
      weekly_days: row.internal_weekly_days,
      monthly_days: row.internal_monthly_days,
      monthly_mode: row.internal_monthly_mode,
      send_hour: row.internal_send_hour,
      send_minute: row.internal_send_minute,
      timezone: row.timezone,
      audit_emails: [],
    },
  ];
}

async function authorizeManualRequest(
  req: Request,
  adminClient: ReturnType<typeof createClient>,
): Promise<AuthorizedUser | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) return null;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    role: String(profile?.role || "").trim().toLowerCase(),
  };
}

async function canUserManageProject(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  role: string,
) {
  if (role === "admin") return true;

  const { data: project } = await adminClient
    .from("projects")
    .select("created_by")
    .eq("id", projectId)
    .maybeSingle();
  if (String(project?.created_by || "") === userId) return true;

  const { data: member } = await adminClient
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return ["admin", "editor"].includes(String(member?.role || "").trim().toLowerCase());
}

async function getManageableProjectIds(
  adminClient: ReturnType<typeof createClient>,
  projectIds: string[],
  userId: string,
  role: string,
) {
  if (role === "admin") return [...new Set(projectIds)];
  if (!projectIds.length) return [];

  const { data: createdProjects, error: createdError } = await adminClient
    .from("projects")
    .select("id")
    .in("id", projectIds)
    .eq("created_by", userId);
  if (createdError) throw createdError;

  const createdIds = new Set((createdProjects ?? []).map((project) => String(project.id)));

  const { data: memberships, error: membershipError } = await adminClient
    .from("project_members")
    .select("project_id, role")
    .in("project_id", projectIds)
    .eq("user_id", userId);
  if (membershipError) throw membershipError;

  const membershipIds = new Set(
    (memberships ?? [])
      .filter((member) => ["admin", "editor"].includes(String(member.role || "").trim().toLowerCase()))
      .map((member) => String(member.project_id)),
  );

  return [...new Set(projectIds.filter((projectId) => createdIds.has(projectId) || membershipIds.has(projectId)))];
}

async function reserveScheduledRun(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  recipientGroup: RecipientGroup,
  localDate: string,
) {
  const dedupeKey = `${projectId}:${recipientGroup}:${localDate}`;
  const { data, error } = await adminClient
    .from("project_update_email_runs")
    .insert({
      project_id: projectId,
      recipient_group: recipientGroup,
      trigger_source: "scheduled",
      local_send_date: localDate,
      dedupe_key: dedupeKey,
      status: "queued",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) return null;
    throw error;
  }

  return data?.id ? String(data.id) : null;
}

async function createManualRun(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  recipientGroup: RecipientGroup,
) {
  const { data, error } = await adminClient
    .from("project_update_email_runs")
    .insert({
      project_id: projectId,
      recipient_group: recipientGroup,
      trigger_source: "manual",
      status: "queued",
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

async function finalizeRun(
  adminClient: ReturnType<typeof createClient>,
  runId: string,
  payload: Record<string, unknown>,
) {
  await adminClient
    .from("project_update_email_runs")
    .update(payload)
    .eq("id", runId);
}

async function getRecipientsForProjects(
  adminClient: ReturnType<typeof createClient>,
  projectIds: string[],
  recipientGroup: RecipientGroup,
) {
  if (projectIds.length === 0) return [];

  const { data: members, error } = await adminClient
    .from("project_members")
    .select("user_id")
    .in("project_id", projectIds);
  if (error) throw error;

  const memberIds = (members ?? []).map((member) => String(member.user_id));
  if (memberIds.length === 0) return [];

  const { data: profiles, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, display_name, email")
    .in("id", memberIds);
  if (profileError) throw profileError;

  const profilesById = new Map((profiles ?? []).map((profile) => [String(profile.id), profile]));
  const allowedRoles = recipientGroup === "internal" ? ["internal", "admin"] : ["client"];
  const recipients: Array<{ email: string; name: string }> = [];
  const uniqueMemberIds = [...new Set((members ?? []).map((member) => String(member.user_id)).filter(Boolean))];
  for (const userId of uniqueMemberIds) {
    const profile = profilesById.get(userId);
    const role = String(profile?.role || "").trim().toLowerCase();
    if (!allowedRoles.includes(role)) continue;

    let email = String(profile?.email || "").trim().toLowerCase();
    if (!email) {
      const { data: userResult, error: userError } = await adminClient.auth.admin.getUserById(userId);
      if (userError || !userResult?.user?.email) continue;
      email = String(userResult.user.email).trim().toLowerCase();
    }

    recipients.push({
      email,
      name: String(
        profile?.display_name || email || (recipientGroup === "internal" ? "Internal" : "Client"),
      ).trim(),
    });
  }

  return recipients.filter((recipient, index, list) =>
    isDeliverableEmail(recipient.email) &&
    list.findIndex((entry) => entry.email === recipient.email) === index
  );
}

async function buildProjectSummary(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
): Promise<ProjectSummary> {
  const { data: fields, error: fieldError } = await adminClient
    .from("fields")
    .select("id, key, label, type, field_role, sort_order, show_in_dashboard, show_in_participant_status, show_in_internal, is_active")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (fieldError) throw fieldError;

  const { data: records, error: recordError } = await adminClient
    .from("records")
    .select("id, title, code, active")
    .eq("project_id", projectId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (recordError) throw recordError;

  const recordIds = (records ?? []).map((record) => record.id);
  const { data: values, error: valueError } = recordIds.length > 0
    ? await adminClient.from("record_values").select("record_id, field_id, value_text, value_select").in("record_id", recordIds)
    : { data: [], error: null };
  if (valueError) throw valueError;

  const fieldsById = new Map((fields ?? []).map((field) => [String(field.id), field]));
  const overallFieldIds = new Set(
    (fields ?? [])
      .filter((field) => String(field.field_role || "").toLowerCase() === "overall_status")
      .map((field) => String(field.id)),
  );
  const stepFields = (fields ?? []).filter((field) => {
    const role = String(field.field_role || "").toLowerCase();
    return field.type === "select"
      && role !== "overall_status"
      && role !== "issue"
      && role !== "decision"
      && role !== "email"
      && field.show_in_dashboard !== false;
  });

  const valuesByRecord = new Map<string, Record<string, string>>();
  const overallByRecord = new Map<string, string>();

  for (const row of values ?? []) {
    const recordId = String(row.record_id);
    const fieldId = String(row.field_id);
    const field = fieldsById.get(fieldId);
    if (!field) continue;
    const value = pickValue(row as Record<string, unknown>);
    if (!valuesByRecord.has(recordId)) valuesByRecord.set(recordId, {});
    valuesByRecord.get(recordId)![String(field.key)] = value;
    if (overallFieldIds.has(fieldId)) {
      overallByRecord.set(recordId, normalizeStatus(value));
    }
  }

  const overallCounts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<string, number>;
  const processRows = stepFields.map((field) => ({
    key: String(field.key),
    label: String(field.label),
    counts: Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<string, number>,
    total: 0,
  }));

  for (const record of records ?? []) {
    const rowValues = valuesByRecord.get(String(record.id)) || {};
    const stepStatuses = processRows.map((processRow) => normalizeStatus(rowValues[processRow.key]));
    const overall = overallByRecord.get(String(record.id)) || computeOverall(stepStatuses);
    overallCounts[overall] += 1;

    processRows.forEach((processRow) => {
      const status = normalizeStatus(rowValues[processRow.key]);
      processRow.counts[status] += 1;
      processRow.total += 1;
    });
  }

  return {
    totalParticipants: (records ?? []).length,
    overallCounts,
    processRows,
  };
}

function aggregateProjectSections(sections: ProjectEmailSection[]) {
  const overallCounts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<string, number>;
  let totalParticipants = 0;

  for (const section of sections) {
    totalParticipants += section.summary.totalParticipants;
    for (const status of STATUS_ORDER) {
      overallCounts[status] += Number(section.summary.overallCounts[status] || 0);
    }
  }

  return {
    totalProjects: sections.length,
    totalParticipants,
    overallCounts,
  };
}

function renderSummaryText(
  projectName: string,
  summary: ProjectSummary,
  scheduleLabel: string,
  audienceLabel: string,
) {
  return [
    `${projectName} ${audienceLabel.toLowerCase()} project update`,
    `Schedule: ${scheduleLabel}`,
    `Total participants: ${summary.totalParticipants}`,
    `Completed: ${summary.overallCounts["Completed"]}`,
    `In Progress: ${summary.overallCounts["In Progress"]}`,
    `Issue: ${summary.overallCounts["Issue"]}`,
    `Not Started: ${summary.overallCounts["Not Started"]}`,
  ].join("\n");
}

function renderPortfolioSummaryText(
  sections: ProjectEmailSection[],
  scheduleLabel: string,
) {
  const aggregate = aggregateProjectSections(sections);

  return [
    "Internal portfolio project update",
    `Schedule: ${scheduleLabel}`,
    `Active projects: ${aggregate.totalProjects}`,
    `Total participants: ${aggregate.totalParticipants}`,
    `Completed: ${aggregate.overallCounts["Completed"]}`,
    `In Progress: ${aggregate.overallCounts["In Progress"]}`,
    `Issue: ${aggregate.overallCounts["Issue"]}`,
    `Not Started: ${aggregate.overallCounts["Not Started"]}`,
    "",
    ...sections.map((section) =>
      `${section.projectName}: ${section.summary.totalParticipants} participants, `
      + `${section.summary.overallCounts["Completed"]} completed, `
      + `${section.summary.overallCounts["In Progress"]} in progress, `
      + `${section.summary.overallCounts["Issue"]} issue, `
      + `${section.summary.overallCounts["Not Started"]} not started`
      + `\n  Steps: ${section.summary.processRows.length
        ? section.summary.processRows.map((row) =>
          `${row.label} (${STATUS_ORDER.map((status) => `${status[0]}:${row.counts[status]}`).join(" ")})`
        ).join(" • ")
        : "No workflow steps configured"}`
    ),
  ].join("\n");
}

function renderProgressBar(count: number, total: number, color: string) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div style="margin-top:8px;">
      <div style="height:10px;border-radius:999px;background:#e5e7eb;overflow:hidden;">
        <div style="height:10px;width:${percent}%;background:${color};border-radius:999px;"></div>
      </div>
      <div style="margin-top:6px;font-size:12px;color:#64748b;">${count} participants (${percent}%)</div>
    </div>
  `;
}

function renderCompactStatusSummary(counts: Record<string, number>) {
  return STATUS_ORDER.map((status) => `${status}: ${counts[status]}`).join(" | ");
}

function renderCompactStepSummary(summary: ProjectSummary) {
  if (!summary.processRows.length) return "No workflow steps configured";
  return summary.processRows.map((row) =>
    `${row.label} (${STATUS_ORDER.map((status) => `${status[0]}:${row.counts[status]}`).join(" ")})`
  ).join(" | ");
}

function renderHtmlEmail(
  projectName: string,
  summary: ProjectSummary,
  scheduleLabel: string,
  dashboardUrl: string,
  audienceLabel: string,
  snapshotDateLabel: string,
) {
  const cards = [
    {
      label: "Total Participants",
      value: String(summary.totalParticipants),
      color: "#0f172a",
      bg: "#f8fafc",
      border: "#cbd5e1",
    },
    ...STATUS_ORDER.map((status) => ({
      label: status,
      value: String(summary.overallCounts[status]),
      color: STATUS_COLORS[status],
      bg: `${STATUS_COLORS[status]}12`,
      border: `${STATUS_COLORS[status]}33`,
    })),
  ].map((card) => {
    const color = card.color;
    return `
      <td style="width:${Math.floor(100 / (STATUS_ORDER.length + 1))}%;padding:0 4px 8px;vertical-align:stretch;">
        <div style="border:1px solid ${card.border};border-radius:14px;padding:10px 12px 9px;background:${card.bg};">
          <div style="font-size:11px;color:#475569;margin-bottom:3px;font-weight:700;white-space:nowrap;">${escapeHtml(card.label)}</div>
          <div style="font-size:22px;line-height:1;font-weight:800;color:${color};">${escapeHtml(card.value)}</div>
        </div>
      </td>
    `;
  }).join("");

  const processRows = summary.processRows.length > 0
    ? summary.processRows.map((row) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(row.label)}</td>
        ${STATUS_ORDER.map((status) => `
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#334155;text-align:center;">${row.counts[status]}</td>
        `).join("")}
      </tr>
    `).join("")
    : `
      <tr>
        <td colspan="5" style="padding:16px 8px;font-size:13px;color:#64748b;text-align:center;">No dashboard process columns are configured for this project yet.</td>
      </tr>
    `;

  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;padding:12px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:780px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:16px 18px 12px;background:linear-gradient(135deg,#eff6ff 0%,#f8fafc 100%);border-bottom:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Mentis Project Hub</div>
            <h1 style="margin:6px 0 4px;font-size:20px;line-height:1.2;">${escapeHtml(projectName)} Update Summary</h1>
            <p style="margin:0;font-size:12px;line-height:1.45;color:#475569;">Latest project status as of ${escapeHtml(snapshotDateLabel)}.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 12px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="table-layout:fixed;">
              <tr>${cards}</tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 18px 0;">
            <div style="border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#ffffff;">
              <div style="font-size:14px;font-weight:800;margin-bottom:4px;">Process Breakdown</div>
              <div style="font-size:11px;color:#64748b;margin-bottom:10px;">Counts by workflow step and current status.</div>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="padding:0 8px 8px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #cbd5e1;">Process</th>
                    ${STATUS_ORDER.map((status) => `
                      <th style="padding:0 8px 8px;text-align:center;font-size:11px;color:#64748b;border-bottom:1px solid #cbd5e1;">${escapeHtml(status)}</th>
                    `).join("")}
                  </tr>
                </thead>
                <tbody>${processRows}</tbody>
              </table>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 18px 16px;">
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;">Open Project Dashboard</a>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

function renderPortfolioHtmlEmail(
  sections: ProjectEmailSection[],
  scheduleLabel: string,
  trackerBaseUrl: string,
  snapshotDateLabel: string,
) {
  const aggregate = aggregateProjectSections(sections);
  const overallCompletion = aggregate.totalParticipants > 0
    ? Math.round((Number(aggregate.overallCounts["Completed"] || 0) / aggregate.totalParticipants) * 100)
    : 0;
  const summaryCards = [
    {
      label: "Active Projects",
      value: String(aggregate.totalProjects),
      color: "#2563eb",
      background: "#eff6ff",
      border: "#bfdbfe",
    },
    {
      label: "Total Participants",
      value: String(aggregate.totalParticipants),
      color: "#0f172a",
      background: "#f8fafc",
      border: "#cbd5e1",
    },
    {
      label: "Overall Completion",
      value: `${overallCompletion}%`,
      color: "#16a34a",
      background: "#f0fdf4",
      border: "#bbf7d0",
    },
  ];
  const summaryCardCells = summaryCards.map((card) => `
    <td style="padding:0 4px 8px;">
      <div style="border:1px solid ${card.border};border-radius:14px;padding:10px 12px 9px;background:${card.background};text-align:center;">
        <div style="font-size:11px;color:#475569;font-weight:700;margin-bottom:3px;">${escapeHtml(card.label)}</div>
        <div style="margin-top:4px;font-size:22px;line-height:1;font-weight:800;color:${card.color};">${escapeHtml(card.value)}</div>
      </div>
    </td>
  `).join("");
  const projectRows = sections.length > 0
    ? sections.map((section) => `
      ${(() => {
        const completed = Number(section.summary.overallCounts["Completed"] || 0);
        const percent = section.summary.totalParticipants > 0
          ? Math.round((completed / section.summary.totalParticipants) * 100)
          : 0;
        return `
      <tr>
        <td style="padding:8px;border:1px solid #dbe3f0;font-size:13px;font-weight:700;color:#0f172a;">
          ${escapeHtml(section.projectName)}
        </td>
        <td style="padding:8px;border:1px solid #dbe3f0;font-size:13px;color:#334155;text-align:center;">${section.summary.totalParticipants}</td>
        <td style="padding:8px;border:1px solid #dbe3f0;font-size:12px;color:#334155;min-width:120px;">
          <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${percent}%</div>
          <div style="height:6px;border-radius:999px;background:#e5e7eb;overflow:hidden;">
            <div style="height:6px;width:${percent}%;background:#2563eb;border-radius:999px;"></div>
          </div>
        </td>
        ${STATUS_ORDER.map((status) => `
          <td style="padding:8px;border:1px solid #dbe3f0;font-size:13px;color:#334155;text-align:center;">${section.summary.overallCounts[status]}</td>
        `).join("")}
        <td style="padding:8px;border:1px solid #dbe3f0;font-size:13px;text-align:center;">
          <a href="${escapeHtml(section.dashboardUrl)}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open</a>
        </td>
      </tr>
    `;
      })()}
    `).join("")
    : `
      <tr>
        <td colspan="8" style="padding:12px;border:1px solid #dbe3f0;font-size:13px;color:#64748b;text-align:center;">No active projects are currently available for the internal summary.</td>
      </tr>
    `;

  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;padding:12px;background:#ffffff;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
      <div style="max-width:860px;margin:0 auto;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Mentis Project Hub</div>
        <h1 style="margin:6px 0 4px;font-size:20px;line-height:1.2;">Internal Portfolio Update Summary</h1>
        <p style="margin:0 0 8px;font-size:12px;line-height:1.45;color:#475569;">Latest all-project status as of ${escapeHtml(snapshotDateLabel)}.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
          <tr>${summaryCardCells}</tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:7px;border:1px solid #cbd5e1;text-align:left;font-size:11px;background:#f8fafc;">Project</th>
              <th style="padding:7px;border:1px solid #cbd5e1;text-align:center;font-size:11px;background:#f8fafc;">Participants</th>
              <th style="padding:7px;border:1px solid #cbd5e1;text-align:left;font-size:11px;background:#f8fafc;">Progress</th>
              ${STATUS_ORDER.map((status) => `
                <th style="padding:7px;border:1px solid #cbd5e1;text-align:center;font-size:11px;background:#f8fafc;">${escapeHtml(status)}</th>
              `).join("")}
              <th style="padding:7px;border:1px solid #cbd5e1;text-align:center;font-size:11px;background:#f8fafc;">Open</th>
            </tr>
          </thead>
          <tbody>${projectRows}</tbody>
        </table>
        <p style="margin:10px 0 0;font-size:12px;">
          <a href="${escapeHtml(`${trackerBaseUrl}/projects.html`)}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open Projects</a>
        </p>
      </div>
    </body>
  </html>`;
}

function compactHtmlForTransport(html: string) {
  return String(html || "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function sendEmailBatch(
  webhookUrl: string,
  recipients: Array<{ email: string; name: string }>,
  auditEmails: string[],
  recipientGroup: RecipientGroup,
  subject: string,
  html: string,
  text: string,
  dashboardUrl: string,
  projectName: string,
  scheduleLabel: string,
) {
  const primaryEmails = normalizeEmailList(recipients.map((recipient) => recipient.email));
  const normalizedAuditEmails = recipientGroup === "client"
    ? normalizeEmailList(auditEmails || [])
    : [];
  const compactHtml = compactHtmlForTransport(html);

  if (primaryEmails.length === 0) {
    throw new Error("No deliverable primary recipients.");
  }
  if (!webhookUrl) {
    throw new Error("N8N_PROJECT_UPDATE_WEBHOOK_URL is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient_group: recipientGroup,
      send_strategy: "loop_primary_with_optional_audit_copy",
      to_emails: primaryEmails,
      cc_emails: [],
      bcc_emails: [],
      audit_emails: normalizedAuditEmails,
      original_cc_emails: normalizeEmailList(auditEmails || []),
      original_bcc_emails: [],
      email_subject: subject,
      email_html: compactHtml,
      message_title: `${projectName} Update Summary`,
      message_body: text,
      action_url: dashboardUrl,
      action_text: "View Dashboard",
      email_type: "project_update_summary",
      project_name: projectName,
      recipient_name: recipients.map((recipient) => recipient.name).join(", "),
      schedule_label: scheduleLabel,
    }),
  });

  if (!response.ok) {
    throw new Error(`email delivery failed: ${response.status} ${await response.text()}`);
  }

  return {
    provider: "n8n",
    sent_to: primaryEmails,
    audit_emails: normalizedAuditEmails,
  };
}

function mapSettingsRow(row: Record<string, unknown>): ProjectSettingsRow {
  const joinedProject = Array.isArray(row.projects) ? row.projects[0] : row.projects;
  return {
    project_id: String(row.project_id),
    is_enabled: Boolean(row.is_enabled),
    schedule_type: String(row.schedule_type) === "monthly" ? "monthly" : "weekly",
    weekly_days: Array.isArray(row.weekly_days) ? row.weekly_days.map(Number) : [],
    monthly_days: Array.isArray(row.monthly_days) ? row.monthly_days.map(Number) : [],
    monthly_mode: String(row.monthly_mode) === "end_of_month" ? "end_of_month" : "dates",
    cc_emails: Array.isArray(row.cc_emails) ? row.cc_emails.map(String) : [],
    bcc_emails: Array.isArray(row.bcc_emails) ? row.bcc_emails.map(String) : [],
    internal_is_enabled: Boolean(row.internal_is_enabled),
    internal_schedule_type: String(row.internal_schedule_type) === "monthly" ? "monthly" : "weekly",
    internal_weekly_days: Array.isArray(row.internal_weekly_days) ? row.internal_weekly_days.map(Number) : [],
    internal_monthly_days: Array.isArray(row.internal_monthly_days) ? row.internal_monthly_days.map(Number) : [],
    internal_monthly_mode: String(row.internal_monthly_mode) === "dates" ? "dates" : "end_of_month",
    send_hour: Number(row.send_hour ?? 9),
    send_minute: Number(row.send_minute ?? 0),
    internal_send_hour: Number(row.internal_send_hour ?? row.send_hour ?? 9),
    internal_send_minute: Number(row.internal_send_minute ?? row.send_minute ?? 0),
    timezone: String(row.timezone || "Asia/Bangkok"),
    last_sent_at: row.last_sent_at ? String(row.last_sent_at) : null,
    last_internal_sent_at: row.last_internal_sent_at ? String(row.last_internal_sent_at) : null,
    project_name: String((joinedProject as { name?: string } | null)?.name || row.project_name || "Project"),
  };
}

function getChannelScheduleFingerprint(channel: DeliveryChannel) {
  return JSON.stringify({
    recipient_group: channel.recipient_group,
    schedule_type: channel.schedule_type,
    weekly_days: channel.weekly_days,
    monthly_days: channel.monthly_days,
    monthly_mode: channel.monthly_mode,
    send_hour: channel.send_hour,
    send_minute: channel.send_minute,
    timezone: channel.timezone,
  });
}

async function buildProjectEmailSections(
  adminClient: ReturnType<typeof createClient>,
  rows: ProjectSettingsRow[],
  trackerBaseUrl: string,
) {
  const sections: ProjectEmailSection[] = [];
  for (const row of rows) {
    sections.push({
      projectId: row.project_id,
      projectName: row.project_name || "Project",
      dashboardUrl: `${trackerBaseUrl}/dashboard.html?project=${encodeURIComponent(row.project_id)}`,
      summary: await buildProjectSummary(adminClient, row.project_id),
    });
  }
  return sections.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("PROJECT_UPDATE_CRON_SECRET") || "";
    const trackerBaseUrl = Deno.env.get("TRACKER_BASE_URL") ?? "https://tracker.mentisglobal.com";
    const webhookUrl = Deno.env.get("N8N_PROJECT_UPDATE_WEBHOOK_URL") || "";

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId || "").trim();
    const requestedGroup = String(body?.recipientGroup || "client").trim().toLowerCase() === "internal"
      ? "internal"
      : "client";
    const cronHeader = req.headers.get("x-project-update-cron-secret") || "";
    const requestedByCron = cronSecret
      ? cronHeader === cronSecret
      : Boolean(cronHeader) && String(body?.source || "").trim().toLowerCase() === "cron";

    if (!webhookUrl) {
      return jsonResponse({ error: "N8N_PROJECT_UPDATE_WEBHOOK_URL is not configured" }, 500);
    }

    let manualUser: AuthorizedUser | null = null;
    if (!requestedByCron) {
      manualUser = await authorizeManualRequest(req, adminClient);
      if (!manualUser?.id) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      if (!projectId) {
        return jsonResponse({ error: "projectId is required for manual sends" }, 400);
      }
      const canManage = await canUserManageProject(adminClient, projectId, manualUser.id, manualUser.role);
      if (!canManage) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    const selectColumns = `
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
      last_internal_sent_at,
      projects(name, status)
    `;

    let settingsRows: ProjectSettingsRow[] = [];
    if (requestedByCron || requestedGroup === "internal") {
      const { data, error } = await adminClient
        .from("project_update_email_settings")
        .select(selectColumns);
      if (error) throw error;

      settingsRows = (data ?? [])
        .filter((row) => String((Array.isArray(row.projects) ? row.projects[0] : row.projects)?.status || "active") === "active")
        .map((row) => mapSettingsRow(row as Record<string, unknown>));
    } else {
      const { data, error } = await adminClient
        .from("project_update_email_settings")
        .select(selectColumns)
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "Project email settings not found" }, 404);
      settingsRows = [mapSettingsRow(data as Record<string, unknown>)];
    }

    const now = new Date();
    const results: Array<Record<string, unknown>> = [];

    const clientRows = requestedByCron
      ? settingsRows
      : settingsRows.filter((row) => row.project_id === projectId);

    if (requestedByCron || requestedGroup === "client") {
      for (const settings of clientRows) {
        const channel = buildChannels(settings).find((entry) => entry.recipient_group === "client");
        if (!channel) continue;

        const localClock = getZonedParts(now, channel.timezone);
        const scheduleCheck = shouldRunSchedule(channel, now);
        if (requestedByCron && !scheduleCheck.due) continue;

        const runId = requestedByCron
          ? (scheduleCheck.localDate
              ? await reserveScheduledRun(adminClient, channel.project_id, channel.recipient_group, scheduleCheck.localDate)
              : null)
          : await createManualRun(adminClient, channel.project_id, channel.recipient_group);

        if (requestedByCron && !runId) {
          results.push({
            project_id: channel.project_id,
            recipient_group: channel.recipient_group,
            status: "skipped",
            reason: "already_sent",
          });
          continue;
        }

        try {
          const recipients = await getRecipientsForProjects(adminClient, [channel.project_id], "client");
          if (recipients.length === 0) {
            if (runId) {
              await finalizeRun(adminClient, runId, {
                status: "skipped",
                error_message: "No client recipients configured for this project.",
              });
            }
            results.push({
              project_id: channel.project_id,
              recipient_group: channel.recipient_group,
              status: "skipped",
              reason: "no_recipients",
            });
            continue;
          }

          const summary = await buildProjectSummary(adminClient, channel.project_id);
          const scheduleLabel = describeProjectUpdateSchedule(channel, { longWeekday: true });
          const snapshotDateLabel = formatReportDate(now, channel.timezone || "Asia/Bangkok");
          const dashboardUrl = `${trackerBaseUrl}/dashboard.html?project=${encodeURIComponent(channel.project_id)}`;
          const projectName = settings.project_name || "Project";
          const subjectPrefix = requestedByCron ? "Scheduled" : "Manual";
          const subject = `[${subjectPrefix} Client Project Update] ${projectName}`;
          const text = renderSummaryText(projectName, summary, scheduleLabel, "Client");
          const html = renderHtmlEmail(projectName, summary, scheduleLabel, dashboardUrl, "Client", snapshotDateLabel);

          const delivery = await sendEmailBatch(
            webhookUrl,
            recipients,
            channel.audit_emails,
            "client",
            subject,
            html,
            text,
            dashboardUrl,
            projectName,
            scheduleLabel,
          );

          await adminClient
            .from("project_update_email_settings")
            .update({
              last_sent_at: now.toISOString(),
              updated_at: now.toISOString(),
              updated_by: manualUser?.id || null,
            })
            .eq("project_id", channel.project_id);

          if (runId) {
            await finalizeRun(adminClient, runId, {
              status: "sent",
              recipients: delivery.sent_to,
              cc_emails: delivery.audit_emails,
              bcc_emails: [],
              summary,
              sent_at: now.toISOString(),
            });
          }

          results.push({
            project_id: channel.project_id,
            project_name: projectName,
            recipient_group: "client",
            status: "sent",
            sent_to: delivery.sent_to,
            audit_emails: delivery.audit_emails,
            provider: delivery.provider,
            total_participants: summary.totalParticipants,
            local_date: scheduleCheck.localDate || localClock.dateKey,
          });
        } catch (error) {
          if (runId) {
            await finalizeRun(adminClient, runId, {
              status: "failed",
              error_message: error instanceof Error ? error.message : "Unexpected error",
            });
          }
          if (!requestedByCron) throw error;
          results.push({
            project_id: channel.project_id,
            recipient_group: "client",
            status: "failed",
            error: error instanceof Error ? error.message : "Unexpected error",
          });
        }
      }
    }

    if (requestedByCron || requestedGroup === "internal") {
      let eligibleInternalRows = settingsRows.filter((row) => row.internal_is_enabled);

      if (!requestedByCron) {
        const manageableProjectIds = await getManageableProjectIds(
          adminClient,
          settingsRows.map((row) => row.project_id),
          manualUser!.id,
          manualUser!.role,
        );
        eligibleInternalRows = settingsRows.filter((row) => manageableProjectIds.includes(row.project_id));
      }

      const groupedRows = new Map<string, Array<{ row: ProjectSettingsRow; channel: DeliveryChannel; localDate: string | null }>>();
      for (const row of eligibleInternalRows) {
        const channel = buildChannels(row).find((entry) => entry.recipient_group === "internal");
        if (!channel) continue;
        const scheduleCheck = shouldRunSchedule(channel, now);
        if (requestedByCron && !scheduleCheck.due) continue;
        const fingerprint = getChannelScheduleFingerprint(channel);
        const group = groupedRows.get(fingerprint) || [];
        group.push({ row, channel, localDate: scheduleCheck.localDate });
        groupedRows.set(fingerprint, group);
      }

      for (const group of groupedRows.values()) {
        const [baseEntry] = group;
        const baseChannel = baseEntry.channel;
        const localDate = baseEntry.localDate || getZonedParts(now, baseChannel.timezone).dateKey;
        const runEntries: Array<{ row: ProjectSettingsRow; runId: string | null }> = [];

        for (const entry of group) {
          const runId = requestedByCron
            ? await reserveScheduledRun(adminClient, entry.row.project_id, "internal", localDate)
            : await createManualRun(adminClient, entry.row.project_id, "internal");

          if (requestedByCron && !runId) {
            results.push({
              project_id: entry.row.project_id,
              recipient_group: "internal",
              status: "skipped",
              reason: "already_sent",
            });
            continue;
          }

          runEntries.push({ row: entry.row, runId });
        }

        if (runEntries.length === 0) continue;

        try {
          const rowsForEmail = runEntries.map((entry) => entry.row);
          const projectIds = rowsForEmail.map((row) => row.project_id);
          const recipients = await getRecipientsForProjects(adminClient, projectIds, "internal");
          if (recipients.length === 0) {
            for (const entry of runEntries) {
              if (!entry.runId) continue;
              await finalizeRun(adminClient, entry.runId, {
                status: "skipped",
                error_message: "No internal recipients configured across active projects.",
              });
            }
            results.push({
              recipient_group: "internal",
              status: "skipped",
              reason: "no_recipients",
              project_ids: projectIds,
            });
            continue;
          }

          const sections = await buildProjectEmailSections(adminClient, rowsForEmail, trackerBaseUrl);
          const scheduleLabel = describeProjectUpdateSchedule(baseChannel, { longWeekday: true });
          const snapshotDateLabel = formatReportDate(now, baseChannel.timezone || "Asia/Bangkok");
          const subjectPrefix = requestedByCron ? "Scheduled" : "Manual";
          const subject = `[${subjectPrefix} Internal Project Update] All Active Projects`;
          const text = renderPortfolioSummaryText(sections, scheduleLabel);
          const html = renderPortfolioHtmlEmail(sections, scheduleLabel, trackerBaseUrl, snapshotDateLabel);
          const aggregateSummary = {
            ...aggregateProjectSections(sections),
            projects: sections.map((section) => ({
              project_id: section.projectId,
              project_name: section.projectName,
              total_participants: section.summary.totalParticipants,
              overall_counts: section.summary.overallCounts,
            })),
          };

          const delivery = await sendEmailBatch(
            webhookUrl,
            recipients,
            [],
            "internal",
            subject,
            html,
            text,
            `${trackerBaseUrl}/projects.html`,
            "All Active Projects",
            scheduleLabel,
          );

          await adminClient
            .from("project_update_email_settings")
            .update({
              last_internal_sent_at: now.toISOString(),
              updated_at: now.toISOString(),
              updated_by: manualUser?.id || null,
            })
            .in("project_id", projectIds);

          for (const entry of runEntries) {
            if (!entry.runId) continue;
            await finalizeRun(adminClient, entry.runId, {
              status: "sent",
              recipients: delivery.sent_to,
              cc_emails: [],
              bcc_emails: [],
              summary: aggregateSummary,
              sent_at: now.toISOString(),
            });
          }

          results.push({
            recipient_group: "internal",
            status: "sent",
            sent_to: delivery.sent_to,
            provider: delivery.provider,
            project_count: projectIds.length,
            project_ids: projectIds,
            project_names: rowsForEmail.map((row) => row.project_name || "Project"),
            total_participants: aggregateSummary.totalParticipants,
            local_date: localDate,
          });
        } catch (error) {
          for (const entry of runEntries) {
            if (!entry.runId) continue;
            await finalizeRun(adminClient, entry.runId, {
              status: "failed",
              error_message: error instanceof Error ? error.message : "Unexpected error",
            });
          }
          if (!requestedByCron) throw error;
          results.push({
            recipient_group: "internal",
            status: "failed",
            project_ids: runEntries.map((entry) => entry.row.project_id),
            error: error instanceof Error ? error.message : "Unexpected error",
          });
        }
      }
    }

    return jsonResponse({
      ok: true,
      source: requestedByCron ? "cron" : "manual",
      processed: results.length,
      results,
      debug: buildDebugInfo(supabaseUrl, webhookUrl, requestedByCron),
    });
  } catch (error) {
    console.error("project-update-summary error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});
