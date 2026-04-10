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
  candidateName: string;
  projectName: string;
  projectId: string;
};

async function getProfileEmail(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function getProjectMemberEmailsByRole(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  roles: string[],
): Promise<string[]> {
  const { data: members } = await adminClient
    .from("project_members")
    .select("user_id, profiles(role)")
    .eq("project_id", projectId);

  const emails: string[] = [];
  for (const m of members ?? []) {
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const role = String(prof?.role ?? "").toLowerCase();
    if (roles.includes(role)) {
      const email = await getProfileEmail(adminClient, String(m.user_id));
      if (email) emails.push(email);
    }
  }
  return emails;
}

async function getCandidateEmailForTicket(
  adminClient: ReturnType<typeof createClient>,
  recordId: string,
): Promise<string | null> {
  if (!recordId) return null;
  const { data: prof } = await adminClient
    .from("profiles")
    .select("id")
    .eq("candidate_record_id", recordId)
    .maybeSingle();
  if (!prof?.id) return null;
  return await getProfileEmail(adminClient, String(prof.id));
}

function eventLabel(type: NotifyBody["eventType"]): string {
  if (type === "reply") return "New Reply";
  if (type === "status_change") return "Status Changed";
  if (type === "priority_change") return "Priority Changed";
  if (type === "new_ticket") return "New Request";
  return "Ticket Updated";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL")!;
    const trackerBaseUrl = Deno.env.get("TRACKER_BASE_URL") ?? "https://tracker.mentisglobal.com";

    if (!n8nWebhookUrl) {
      console.warn("N8N_WEBHOOK_URL not set — skipping notification");
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json()) as NotifyBody;
    const { ticketId, eventType, authorId, authorRole, projectId } = body;

    if (!ticketId || !eventType) {
      return new Response(JSON.stringify({ error: "ticketId and eventType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load ticket to get record_id and project_id fallback
    const { data: ticket } = await adminClient
      .from("requests")
      .select("id, project_id, created_by, owner_user_id, subject, candidate_name, record_id")
      .eq("id", ticketId)
      .maybeSingle();

    if (!ticket) {
      return new Response(JSON.stringify({ error: "Ticket not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolvedProjectId = projectId || ticket.project_id;

    // Resolve recipient emails based on author role
    const authorEmail = await getProfileEmail(adminClient, authorId);
    const recipientSet = new Set<string>();
    const candidateEmailSet = new Set<string>(); // tracks which emails belong to candidates

    if (authorRole === "candidate") {
      const emails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["internal", "admin", "client"]);
      for (const e of emails) recipientSet.add(e);
      if (authorEmail) candidateEmailSet.add(authorEmail);
    } else if (authorRole === "client") {
      const internalAdminEmails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["internal", "admin"]);
      for (const e of internalAdminEmails) recipientSet.add(e);
      if (ticket.record_id) {
        const candidateEmail = await getCandidateEmailForTicket(adminClient, ticket.record_id);
        if (candidateEmail) { recipientSet.add(candidateEmail); candidateEmailSet.add(candidateEmail); }
      }
    } else {
      // internal / admin → notify candidate + clients
      if (ticket.record_id) {
        const candidateEmail = await getCandidateEmailForTicket(adminClient, ticket.record_id);
        if (candidateEmail) { recipientSet.add(candidateEmail); candidateEmailSet.add(candidateEmail); }
      }
      const clientEmails = await getProjectMemberEmailsByRole(adminClient, resolvedProjectId, ["client"]);
      for (const e of clientEmails) recipientSet.add(e);
    }

    // Never email the author, except candidates get a copy of their own submission
    if (authorEmail && authorRole !== "candidate") recipientSet.delete(authorEmail);

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const recipients = Array.from(recipientSet).filter((e) => Boolean(e) && isValidEmail(e));

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no recipients" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const label = eventLabel(eventType);
    const ticketsUrl = `${trackerBaseUrl}/tickets.html?project=${resolvedProjectId}`;
    const candidateUrl = `${trackerBaseUrl}/candidate-status.html`;

    // Send one request per recipient so n8n SES node receives a single email per call
    const errors: string[] = [];
    for (const recipient of recipients) {
      const actionUrl = candidateEmailSet.has(recipient) ? candidateUrl : ticketsUrl;
      const n8nPayload = {
        to_emails: [recipient],
        email_subject: `[${label}] ${body.ticketSubject} — ${body.projectName}`,
        name: "Team",
        message_title: body.ticketSubject,
        message_body: body.message,
        action_url: actionUrl,
        action_text: "View Ticket",
        event_type: label,
        author_name: body.authorName,
        author_role: authorRole,
        candidate_name: body.candidateName,
        project_name: body.projectName,
      };

      const n8nRes = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n8nPayload),
      });

      if (!n8nRes.ok) {
        const text = await n8nRes.text();
        errors.push(`${recipient}: n8n ${n8nRes.status} ${text}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    return new Response(JSON.stringify({ ok: true, sent_to: recipients }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ticket-notify error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
