// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingNotifyBody = {
  bookingId: string;
};

type EmailPayload = {
  to: string[];
  subject: string;
  title: string;
  body: string;
  actionUrl: string;
  actionText: string;
  projectName: string;
  participantName: string;
  stepLabel: string;
  slotLabel: string;
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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizeTimeText(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatSlotLabel(slot: { slot_date?: string; start_time?: string; end_time?: string; timezone?: string }) {
  const dateKey = String(slot?.slot_date || "");
  const [year, month, day] = dateKey.split("-").map(Number);
  const dateLabel = year && month && day
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(year, month - 1, day))
    : dateKey;
  const start = normalizeTimeText(slot?.start_time);
  const end = normalizeTimeText(slot?.end_time);
  const time = end ? `${start}-${end}` : start;
  const timezone = String(slot?.timezone || "Asia/Bangkok");
  return [dateLabel, time, timezone].filter(Boolean).join(", ");
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

async function getParticipantEmail(
  adminClient: ReturnType<typeof createClient>,
  recordId: string,
  projectId: string,
): Promise<string | null> {
  const { data: prof } = await adminClient
    .from("profiles")
    .select("id")
    .eq("participant_record_id", recordId)
    .maybeSingle();
  if (prof?.id) {
    const email = await getProfileEmail(adminClient, String(prof.id));
    if (email) return email;
  }

  const { data: emailField } = await adminClient
    .from("fields")
    .select("id")
    .eq("project_id", projectId)
    .or("key.eq.email,field_role.eq.email")
    .limit(1)
    .maybeSingle();
  if (!emailField?.id) return null;

  const { data: emailValue } = await adminClient
    .from("record_values")
    .select("value_text, value_select")
    .eq("record_id", recordId)
    .eq("field_id", emailField.id)
    .maybeSingle();

  const raw = String(emailValue?.value_text || emailValue?.value_select || "").trim().toLowerCase();
  return raw || null;
}

async function getConsultantEmails(
  adminClient: ReturnType<typeof createClient>,
  projectId: string,
  fieldId: string,
): Promise<string[]> {
  const { data, error } = await adminClient
    .from("project_availability_consultants")
    .select("email")
    .eq("project_id", projectId)
    .eq("field_id", fieldId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("booking-notify: cannot load consultants", error.message);
    return [];
  }
  return (data || [])
    .map((row) => String(row?.email || "").trim().toLowerCase())
    .filter((email, index, list) => isValidEmail(email) && list.indexOf(email) === index);
}

async function sendViaN8n(n8nWebhookUrl: string, payload: EmailPayload) {
  const res = await fetch(n8nWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_emails: payload.to,
      email_subject: payload.subject,
      name: payload.participantName || "Participant",
      message_title: payload.title,
      message_body: payload.body,
      action_url: payload.actionUrl,
      action_text: payload.actionText,
      event_type: "Booking Confirmed",
      participant_name: payload.participantName,
      project_name: payload.projectName,
      booking_step: payload.stepLabel,
      booking_slot: payload.slotLabel,
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
      <p style="margin:0 0 16px;color:#475569">
        Project: ${escapeHtml(payload.projectName || "-")}<br>
        Participant: ${escapeHtml(payload.participantName || "-")}<br>
        Step: ${escapeHtml(payload.stepLabel || "-")}<br>
        Booking: ${escapeHtml(payload.slotLabel || "-")}
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
      to: payload.to,
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const trackerBaseUrl = Deno.env.get("TRACKER_BASE_URL") ?? "https://tracker.mentisglobal.com";
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let bookingId = "";
  try {
    const body = (await req.json()) as BookingNotifyBody;
    bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) return json({ error: "bookingId is required" }, 400);

    const { data: booking, error: bookingError } = await adminClient
      .from("project_availability_bookings")
      .select("id, project_id, record_id, field_id, slot_id, notification_sent_at")
      .eq("id", bookingId)
      .eq("status", "booked")
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return json({ error: "Booking not found" }, 404);
    if (booking.notification_sent_at) {
      return json({ ok: true, skipped: true, reason: "already notified" });
    }

    const [{ data: record }, { data: field }, { data: slot }, { data: project }] = await Promise.all([
      adminClient.from("records").select("id, code, title").eq("id", booking.record_id).maybeSingle(),
      adminClient.from("fields").select("label").eq("id", booking.field_id).maybeSingle(),
      adminClient.from("project_availability_slots").select("slot_date, start_time, end_time, timezone").eq("id", booking.slot_id).maybeSingle(),
      adminClient.from("projects").select("name").eq("id", booking.project_id).maybeSingle(),
    ]);

    const recipient = await getParticipantEmail(adminClient, booking.record_id, booking.project_id);
    if (!recipient || !isValidEmail(recipient)) {
      await adminClient
        .from("project_availability_bookings")
        .update({ notification_error: "Participant email not found", updated_at: new Date().toISOString() })
        .eq("id", bookingId);
      return json({ ok: false, skipped: true, reason: "participant email not found" });
    }

    const projectName = String(project?.name || "Project");
    const participantName = String(record?.title || record?.code || "Participant");
    const stepLabel = String(field?.label || "Booking");
    const slotLabel = formatSlotLabel(slot || {});
    const actionUrl = `${trackerBaseUrl}/participant-status.html`;
    const consultantRecipients = await getConsultantEmails(adminClient, booking.project_id, booking.field_id);
    const recipients = [recipient, ...consultantRecipients]
      .map((email) => email.trim().toLowerCase())
      .filter((email, index, list) => isValidEmail(email) && list.indexOf(email) === index);

    const result = await sendEmail({
      to: recipients,
      subject: `[Booking Confirmed] ${stepLabel} - ${projectName}`,
      title: "Booking confirmed",
      body: `${participantName}'s booking for ${stepLabel} is confirmed.\n\nDate and time: ${slotLabel}`,
      actionUrl,
      actionText: "View My Status",
      projectName,
      participantName,
      stepLabel,
      slotLabel,
    });

    await adminClient
      .from("project_availability_bookings")
      .update({ notification_sent_at: new Date().toISOString(), notification_error: null, updated_at: new Date().toISOString() })
      .eq("id", bookingId);

    return json({ ok: true, sent_to: recipients, provider: result.provider });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("booking-notify error:", err);
    if (bookingId) {
      await adminClient
        .from("project_availability_bookings")
        .update({ notification_error: message, updated_at: new Date().toISOString() })
        .eq("id", bookingId);
    }
    return json({ error: message }, 500);
  }
});
