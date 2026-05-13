// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotifyBody = {
  ticketId: string;
  eventType: "reply" | "status_change" | "priority_change" | "ticket_updated" | "new_ticket";
  authorId: string;
  authorName: string;
  authorRole: string;
  message: string;
  ticketSubject: string;
  participantName: string;
  projectName: string;
  projectId: string;
};

type EmailPayload = {
  to: string;
  subject: string;
  title: string;
  body: string;
  actionUrl: string;
  actionText: string;
  eventType: string;
  authorName: string;
  authorRole: string;
  participantName: string;
  projectName: string;
};

type CallerProfile = {
  role?: string | null;
  participant_record_id?: string | null;
  display_name?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function eventLabel(type: NotifyBody["eventType"]): string {
  if (type === "reply") return "New Reply";
  if (type === "status_change") return "Status Changed";
  if (type === "priority_change") return "Priority Changed";
  if (type === "new_ticket") return "New Request";
  return "Ticket Updated";
}

async function getAuthenticatedCaller(
  adminClient: ReturnType<typeof createClient>,
  req: Request,
): Promise<{ id: string; email?: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;

  const { data, error } = await adminClient.auth.getUser(match[1].trim());
  if (error || !data?.user?.id) return null;
  return data.user;
}

async function getCallerProfile(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("role, participant_record_id, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CallerProfile;
}

async function canCallerAccessTicket(
  adminClient: ReturnType<typeof createClient>,
  ticket: Record<string, unknown>,
  callerId: string,
  profile: CallerProfile | null,
): Promise<boolean> {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "admin") return true;

  const projectId = String(ticket.project_id || "").trim();
  const recordId = String(ticket.record_id || "").trim();
  if (role === "participant") {
    return String(ticket.created_by || "") === callerId || Boolean(recordId && String(profile?.participant_record_id || "") === recordId);
  }
  if (role !== "internal" && role !== "client") return false;
  if (!projectId) return false;

  const [{ data: member }, { data: project }] = await Promise.all([
    adminClient
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", callerId)
      .maybeSingle(),
    adminClient
      .from("projects")
      .select("created_by")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  if (project?.created_by === callerId) return true;
  const memberRole = String(member?.role || "").trim().toLowerCase();
  return ["admin", "editor", "viewer"].includes(memberRole);
}

async function getProfileEmail(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  if (!userId) return null;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.email) return String(profile.email).trim().toLowerCase();

  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email.trim().toLowerCase();
}

async function getProjectMemberEmailsByRole(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  roles: string[],
): Promise<string[]> {
  const { data: members, error: membersError } = await adminClient
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  if (membersError || !members?.length) return [];

  const userIds = Array.from(
    new Set(
      members
        .map((member) => String(member.user_id || "").trim())
        .filter(Boolean),
    ),
  );
  if (!userIds.length) return [];

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("id, role")
    .in("id", userIds);
  if (profilesError || !profiles?.length) return [];

  const roleByUserId = new Map(
    profiles.map((profile) => [
      String(profile.id),
      String(profile.role ?? "").toLowerCase(),
    ]),
  );

  const emails: string[] = [];
  for (const userId of userIds) {
    const role = roleByUserId.get(userId) ?? "";
    if (!roles.includes(role)) continue;
    const email = await getProfileEmail(adminClient, userId);
    if (email) emails.push(email);
  }
  return emails;
}

async function getParticipantEmailForTicket(
  adminClient: ReturnType<typeof createClient>,
  recordId: string,
): Promise<string | null> {
  if (!recordId) return null;
  const { data: prof } = await adminClient
    .from("profiles")
    .select("id")
    .eq("participant_record_id", recordId)
    .maybeSingle();
  if (!prof?.id) return null;
  return await getProfileEmail(adminClient, String(prof.id));
}

async function sendViaN8n(n8nWebhookUrl: string, payload: EmailPayload) {
  const res = await fetch(n8nWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_emails: [payload.to],
      email_subject: payload.subject,
      name: "Team",
      message_title: payload.title,
      message_body: payload.body,
      action_url: payload.actionUrl,
      action_text: payload.actionText,
      event_type: payload.eventType,
      author_name: payload.authorName,
      author_role: payload.authorRole,
      participant_name: payload.participantName,
      project_name: payload.projectName,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n ${res.status} ${text}`);
  }
}

async function sendViaResend(apiKey: string, fromEmail: string, payload: EmailPayload) {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px">${escapeHtml(payload.title)}</h2>
      <p style="margin:0 0 12px">${escapeHtml(payload.body).replaceAll("\n", "<br>")}</p>
      <p style="margin:0 0 12px;color:#475569">
        ${escapeHtml(payload.eventType)} by ${escapeHtml(payload.authorName || "Unknown")} (${escapeHtml(payload.authorRole || "-")})
      </p>
      <p style="margin:0 0 16px;color:#475569">
        Project: ${escapeHtml(payload.projectName || "-")}<br>
        Participant: ${escapeHtml(payload.participantName || "-")}
      </p>
      <a href="${escapeHtml(payload.actionUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px">
        ${escapeHtml(payload.actionText)}
      </a>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [payload.to],
      subject: payload.subject,
      html,
      text: `${payload.title}\n\n${payload.body}\n\n${payload.actionText}: ${payload.actionUrl}`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`resend ${res.status} ${text}`);
  }
}

async function sendEmail(payload: EmailPayload) {
  const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const notifyFromEmail = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "";
  const providerErrors: string[] = [];

  if (n8nWebhookUrl) {
    try {
      await sendViaN8n(n8nWebhookUrl, payload);
      return { provider: "n8n" };
    } catch (err) {
      providerErrors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    providerErrors.push("N8N_WEBHOOK_URL is not configured");
  }

  if (resendApiKey && notifyFromEmail) {
    try {
      await sendViaResend(resendApiKey, notifyFromEmail, payload);
      return { provider: "resend", providerErrors };
    } catch (err) {
      providerErrors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    providerErrors.push("RESEND_API_KEY or NOTIFY_FROM_EMAIL is not configured");
  }

  throw new Error(providerErrors.join("; "));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const trackerBaseUrl = Deno.env.get("TRACKER_BASE_URL") ?? "https://tracker.mentisglobal.com";

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json()) as NotifyBody;
    const { ticketId, eventType, authorId, projectId } = body;
    if (!ticketId || !eventType || !authorId) return json({ error: "ticketId, eventType, and authorId are required" }, 400);

    const caller = await getAuthenticatedCaller(adminClient, req);
    if (!caller?.id) return json({ error: "Unauthorized" }, 401);
    if (String(authorId) !== String(caller.id)) return json({ error: "Forbidden" }, 403);

    const callerProfile = await getCallerProfile(adminClient, caller.id);
    const callerRole = String(callerProfile?.role || "").trim().toLowerCase();
    if (!callerRole) return json({ error: "Forbidden" }, 403);
    const callerName = String(callerProfile?.display_name || caller.email || body.authorName || "Unknown").trim();

    const { data: ticket } = await adminClient
      .from("requests")
      .select("id, project_id, created_by, owner_user_id, subject, participant_name, record_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) return json({ error: "Ticket not found" }, 404);
    if (projectId && String(projectId) !== String(ticket.project_id)) {
      return json({ error: "Ticket project mismatch" }, 400);
    }
    if (!(await canCallerAccessTicket(adminClient, ticket as Record<string, unknown>, caller.id, callerProfile))) {
      return json({ error: "Forbidden" }, 403);
    }

    const resolvedProjectId = String(ticket.project_id || projectId || "");
    const authorEmail = await getProfileEmail(adminClient, caller.id);
    const recipientSet = new Set<string>();
    const participantEmailSet = new Set<string>();

    if (callerRole === "participant") {
      const emails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["internal", "admin", "client"]);
      for (const email of emails) recipientSet.add(email);
      if (authorEmail) participantEmailSet.add(authorEmail);
    } else if (callerRole === "client") {
      const emails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["internal", "admin"]);
      for (const email of emails) recipientSet.add(email);
      if (ticket.record_id) {
        const participantEmail = await getParticipantEmailForTicket(adminClient, ticket.record_id);
        if (participantEmail) {
          recipientSet.add(participantEmail);
          participantEmailSet.add(participantEmail);
        }
      }
    } else {
      if (ticket.record_id) {
        const participantEmail = await getParticipantEmailForTicket(adminClient, ticket.record_id);
        if (participantEmail) {
          recipientSet.add(participantEmail);
          participantEmailSet.add(participantEmail);
        }
      }
      const emails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["client"]);
      for (const email of emails) recipientSet.add(email);
    }

    if (authorEmail && callerRole !== "participant") recipientSet.delete(authorEmail);

    const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const recipients = Array.from(recipientSet).filter((email) => Boolean(email) && isValidEmail(email));
    if (recipients.length === 0) return json({ ok: false, skipped: true, reason: "no recipients" });

    const label = eventLabel(eventType);
    const ticketsUrl = `${trackerBaseUrl}/tickets.html?project=${resolvedProjectId}`;
    const participantUrl = `${trackerBaseUrl}/participant-status.html`;

    const sent: Array<{ email: string; provider: string }> = [];
    const errors: string[] = [];
    for (const recipient of recipients) {
      const actionUrl = participantEmailSet.has(recipient) ? participantUrl : ticketsUrl;
      try {
        const result = await sendEmail({
          to: recipient,
          subject: `[${label}] ${body.ticketSubject} - ${body.projectName}`,
          title: body.ticketSubject,
          body: body.message,
          actionUrl,
          actionText: "View Ticket",
          eventType: label,
          authorName: callerName,
          authorRole: callerRole,
          participantName: body.participantName,
          projectName: body.projectName,
        });
        sent.push({ email: recipient, provider: result.provider });
      } catch (err) {
        errors.push(`${recipient}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length > 0) throw new Error(errors.join("; "));
    return json({ ok: true, sent_to: sent.map((item) => item.email), sent });
  } catch (err) {
    console.error("ticket-notify error:", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
