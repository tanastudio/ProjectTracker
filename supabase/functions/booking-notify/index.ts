// English comments only

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-booking-followup-cron-secret, x-project-update-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingNotifyBody = {
  action?: "send_booking_confirmation" | "send_session_followups" | "get_session_feedback" | "submit_session_feedback";
  source?: string;
  bookingId?: string;
  token?: string;
  sessionStatus?: "completed" | "not_completed";
  comment?: string;
};

type EmailPayload = {
  to: string;
  subject: string;
  title: string;
  body: string;
  actionUrl: string;
  actionText: string;
  projectName: string;
  participantName: string;
  participantEmail: string;
  stepLabel: string;
  slotLabel: string;
  consultantName: string;
  consultantEmail: string;
  recipientName: string;
  recipientRole: "participant" | "consultant";
  senderName: string;
  senderRole: string;
  calendarInvite: CalendarInvitePayload | null;
  emailType?: string;
  eventType?: string;
};

type DeliveryTarget = {
  email: string;
  name: string;
  role: EmailPayload["recipientRole"];
};

type CallerProfile = {
  role?: string | null;
  participant_record_id?: string | null;
};

type CalendarInvitePayload = {
  filename: string;
  content: string;
  contentBase64: string;
  mimeType: string;
  uid: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  summary: string;
  description: string;
};

type BookingSlotRow = {
  slot_date?: string;
  start_time?: string;
  end_time?: string;
  timezone?: string;
  is_active?: boolean;
  field_id?: string;
  consultant_id?: string;
};

const DEFAULT_SENDER_NAME = "Mentis Workflows";
const DEFAULT_SENDER_ROLE = "System";
const DEFAULT_ORGANIZER_EMAIL = "workflows@mentisglobal.com";

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

function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "undefined" || text.toLowerCase() === "null") return fallback;
  return text;
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
    .select("role, participant_record_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CallerProfile;
}

async function canCallerAccessBooking(
  adminClient: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
  callerId: string,
  profile: CallerProfile | null,
): Promise<boolean> {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "admin") return true;

  const projectId = String(booking.project_id || "").trim();
  const recordId = String(booking.record_id || "").trim();
  if (role === "participant") {
    return Boolean(recordId && String(profile?.participant_record_id || "") === recordId);
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

function normalizeTimeText(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function zonedDateTimeToDate(dateKey: unknown, timeText: unknown, timeZone = "Asia/Bangkok") {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const [hour, minute] = normalizeTimeText(timeText).split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instantUtc = targetUtc;
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(instantUtc), timeZone);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instantUtc += targetUtc - zonedAsUtc;
  }
  return new Date(instantUtc);
}

function formatIcsUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: unknown) {
  return cleanText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function foldIcsLine(line: string) {
  const folded: string[] = [];
  let remaining = line;
  while (remaining.length > 73) {
    folded.push(remaining.slice(0, 73));
    remaining = ` ${remaining.slice(73)}`;
  }
  folded.push(remaining);
  return folded.join("\r\n");
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function generatePublicToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeFilenamePart(value: unknown) {
  return cleanText(value, "booking")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "booking";
}

function buildCalendarInvite(params: {
  bookingId: string;
  slot: { slot_date?: string; start_time?: string; end_time?: string; timezone?: string } | null;
  projectName: string;
  participantName: string;
  participantEmail: string;
  stepLabel: string;
  consultantName: string;
  consultantEmail: string;
  actionUrl: string;
  attendees: DeliveryTarget[];
  organizerEmail: string;
}) {
  const timezone = cleanText(params.slot?.timezone, "Asia/Bangkok");
  const start = zonedDateTimeToDate(params.slot?.slot_date, params.slot?.start_time, timezone);
  if (!start) return null;
  const end = params.slot?.end_time
    ? zonedDateTimeToDate(params.slot.slot_date, params.slot.end_time, timezone)
    : addMinutes(start, 60);
  const safeEnd = end && end > start ? end : addMinutes(start, 60);
  const uid = `${params.bookingId}@project-tracker.mentisglobal.com`;
  const summary = `${params.stepLabel} - ${params.projectName}`;
  const description = [
    `Booking confirmed for ${params.stepLabel}.`,
    `Project: ${params.projectName}`,
    `Participant: ${params.participantName}`,
    `Consultant: ${params.consultantName || params.consultantEmail || "-"}`,
    `View booking: ${params.actionUrl}`,
  ].join("\n");
  const organizerEmail = isValidEmail(params.organizerEmail)
    ? params.organizerEmail.trim().toLowerCase()
    : DEFAULT_ORGANIZER_EMAIL;
  const attendeeLines = params.attendees.map((target) => {
    const cn = escapeIcsText(target.name || target.email);
    return `ATTENDEE;CN=${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${target.email}`;
  });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mentis Global//Project Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(safeEnd)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText("Details provided upon confirmation")}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    `ORGANIZER;CN=${escapeIcsText(DEFAULT_SENDER_NAME)}:mailto:${organizerEmail}`,
    ...attendeeLines,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const content = lines.map(foldIcsLine).join("\r\n") + "\r\n";
  return {
    filename: `${sanitizeFilenamePart(params.stepLabel)}-${sanitizeFilenamePart(params.projectName)}.ics`,
    content,
    contentBase64: encodeBase64Utf8(content),
    mimeType: "text/calendar; method=REQUEST; charset=UTF-8",
    uid,
    startsAt: start.toISOString(),
    endsAt: safeEnd.toISOString(),
    timezone,
    summary,
    description,
  };
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
      to_emails: [payload.to],
      to_email: payload.to,
      email_subject: payload.subject,
      name: payload.recipientName || payload.participantName || "Participant",
      recipient_name: payload.recipientName,
      recipient_email: payload.to,
      recipient_role: payload.recipientRole,
      message_title: payload.title,
      message_body: payload.body,
      action_url: payload.actionUrl,
      action_text: payload.actionText,
      event_type: payload.eventType || "Booking Confirmed",
      email_type: payload.emailType || "booking_confirmed",
      candidate_name: payload.participantName,
      candidate_email: payload.participantEmail,
      participant_name: payload.participantName,
      participant_email: payload.participantEmail,
      project_name: payload.projectName,
      booking_step: payload.stepLabel,
      booking_slot: payload.slotLabel,
      consultant_name: payload.consultantName,
      consultant_email: payload.consultantEmail,
      author_name: payload.senderName,
      author_role: payload.senderRole,
      sender_name: payload.senderName,
      sender_role: payload.senderRole,
      sender_display_name: payload.senderName,
      sent_by_name: payload.senderName,
      sent_by_role: payload.senderRole,
      sent_by: payload.senderName,
      from_name: payload.senderName,
      support_team_name: payload.senderName,
      calendar_invite: payload.calendarInvite ? {
        filename: payload.calendarInvite.filename,
        content: payload.calendarInvite.content,
        content_base64: payload.calendarInvite.contentBase64,
        mime_type: payload.calendarInvite.mimeType,
        uid: payload.calendarInvite.uid,
        starts_at: payload.calendarInvite.startsAt,
        ends_at: payload.calendarInvite.endsAt,
        timezone: payload.calendarInvite.timezone,
        summary: payload.calendarInvite.summary,
        description: payload.calendarInvite.description,
      } : null,
      calendar_ics: payload.calendarInvite?.content || "",
      calendar_ics_base64: payload.calendarInvite?.contentBase64 || "",
      calendar_filename: payload.calendarInvite?.filename || "",
      calendar_mime_type: payload.calendarInvite?.mimeType || "",
      event_uid: payload.calendarInvite?.uid || "",
      event_start_iso: payload.calendarInvite?.startsAt || "",
      event_end_iso: payload.calendarInvite?.endsAt || "",
      event_timezone: payload.calendarInvite?.timezone || "",
      attachments: payload.calendarInvite ? [{
        filename: payload.calendarInvite.filename,
        content: payload.calendarInvite.contentBase64,
        contentType: payload.calendarInvite.mimeType,
        mime_type: payload.calendarInvite.mimeType,
      }] : [],
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
        Consultant: ${escapeHtml(payload.consultantName || payload.consultantEmail || "-")}<br>
        Booking: ${escapeHtml(payload.slotLabel || "-")}
      </p>
      <a href="${escapeHtml(payload.actionUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px">
        ${escapeHtml(payload.actionText)}
      </a>
    </div>`;

  const resendPayload: Record<string, unknown> = {
    from: fromEmail,
    to: [payload.to],
    subject: payload.subject,
    html,
    text: `${payload.title}\n\n${payload.body}\n\n${payload.actionText}: ${payload.actionUrl}`,
  };
  if (payload.calendarInvite) {
    resendPayload.attachments = [{
      filename: payload.calendarInvite.filename,
      content: payload.calendarInvite.contentBase64,
    }];
    resendPayload.headers = {
      "Content-Class": "urn:content-classes:calendarmessage",
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendPayload),
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

function buildDeliveryTargets(
  participantEmail: string,
  participantName: string,
  consultantEmails: string[],
  consultantName: string,
): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];
  const seen = new Set<string>();
  const addTarget = (target: DeliveryTarget) => {
    const email = String(target.email || "").trim().toLowerCase();
    if (!isValidEmail(email) || seen.has(email)) return;
    seen.add(email);
    targets.push({ ...target, email });
  };

  addTarget({
    email: participantEmail,
    name: participantName || "Participant",
    role: "participant",
  });
  for (const email of consultantEmails) {
    addTarget({
      email,
      name: consultantName || "Consultant",
      role: "consultant",
    });
  }
  return targets;
}

function buildBodyForTarget(target: DeliveryTarget, participantName: string, stepLabel: string, consultantName: string, slotLabel: string) {
  if (target.role === "consultant") {
    return `${participantName}'s booking for ${stepLabel} is confirmed with you.\n\nCandidate: ${participantName}\nDate and time: ${slotLabel}`;
  }
  return `Your booking for ${stepLabel} is confirmed.\n\nConsultant: ${consultantName || "-"}\nDate and time: ${slotLabel}`;
}

function getSessionStatusLabel(status: unknown) {
  const normalized = String(status || "pending").trim().toLowerCase();
  if (normalized === "completed") return "Completed";
  if (normalized === "not_completed") return "Not Complete";
  return "Pending Confirmation";
}

function getSlotEndInstant(slot: { slot_date?: string; start_time?: string; end_time?: string; timezone?: string } | null) {
  if (!slot) return null;
  const timezone = cleanText(slot.timezone, "Asia/Bangkok");
  const end = slot.end_time
    ? zonedDateTimeToDate(slot.slot_date, slot.end_time, timezone)
    : null;
  if (end) return end;
  const start = zonedDateTimeToDate(slot.slot_date, slot.start_time, timezone);
  return start ? addMinutes(start, 60) : null;
}

async function loadBookingContext(
  adminClient: ReturnType<typeof createClient>,
  booking: Record<string, string>,
) {
  const [{ data: record }, { data: field }, { data: slot }, { data: project }] = await Promise.all([
    adminClient.from("records").select("id, code, title").eq("id", booking.record_id).maybeSingle(),
    adminClient.from("fields").select("label").eq("id", booking.field_id).maybeSingle(),
    adminClient.from("project_availability_slots").select("slot_date, start_time, end_time, timezone, is_active, field_id, consultant_id").eq("id", booking.slot_id).maybeSingle(),
    adminClient.from("projects").select("name").eq("id", booking.project_id).maybeSingle(),
  ]);

  const participantEmail = await getParticipantEmail(adminClient, booking.record_id, booking.project_id);
  const assignedConsultantEmail = String(booking.consultant_email || "").trim().toLowerCase();
  const consultantName = cleanText(booking.consultant_name, assignedConsultantEmail || "Consultant");

  return {
    record,
    field,
    slot,
    project,
    projectName: cleanText(project?.name, "Project"),
    participantName: cleanText(record?.title, cleanText(record?.code, "Participant")),
    participantEmail: participantEmail || "",
    stepLabel: cleanText(field?.label, "Booking"),
    slotLabel: formatSlotLabel(slot || {}),
    consultantEmail: assignedConsultantEmail,
    consultantName,
  };
}

async function sendSessionFollowupForBooking(
  adminClient: ReturnType<typeof createClient>,
  trackerBaseUrl: string,
  booking: Record<string, string>,
) {
  const context = await loadBookingContext(adminClient, booking);
  if (!context.consultantEmail || !isValidEmail(context.consultantEmail)) {
    throw new Error("Consultant email not found");
  }

  const token = generatePublicToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const feedbackUrl = `${trackerBaseUrl}/booking-session-feedback.html?token=${encodeURIComponent(token)}`;

  const { error: tokenError } = await adminClient
    .from("project_availability_bookings")
    .update({
      session_followup_token_hash: tokenHash,
      session_followup_token_expires_at: expiresAt,
      session_followup_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id)
    .eq("status", "booked")
    .eq("session_status", "pending");
  if (tokenError) throw tokenError;

  const result = await sendEmail({
    to: context.consultantEmail,
    subject: `[Session Confirmation] ${context.stepLabel} - ${context.projectName}`,
    title: "Confirm session completion",
    body: [
      `Please confirm whether the session is complete.`,
      ``,
      `Participant: ${context.participantName}`,
      `Step: ${context.stepLabel}`,
      `Date and time: ${context.slotLabel}`,
      ``,
      `You can also add a short comment for the project team.`,
    ].join("\n"),
    actionUrl: feedbackUrl,
    actionText: "Confirm Session",
    projectName: context.projectName,
    participantName: context.participantName,
    participantEmail: context.participantEmail,
    stepLabel: context.stepLabel,
    slotLabel: context.slotLabel,
    consultantName: context.consultantName,
    consultantEmail: context.consultantEmail,
    recipientName: context.consultantName,
    recipientRole: "consultant",
    senderName: DEFAULT_SENDER_NAME,
    senderRole: DEFAULT_SENDER_ROLE,
    calendarInvite: null,
    eventType: "Booking Session Follow-up",
    emailType: "booking_session_followup",
  });

  await adminClient
    .from("project_availability_bookings")
    .update({
      session_followup_sent_at: new Date().toISOString(),
      session_followup_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  return { bookingId: booking.id, provider: result.provider, consultantEmail: context.consultantEmail };
}

async function sendDueSessionFollowups(
  adminClient: ReturnType<typeof createClient>,
  trackerBaseUrl: string,
) {
  const { data, error } = await adminClient
    .from("project_availability_bookings")
    .select("id, project_id, record_id, field_id, slot_id, consultant_name, consultant_email, session_status, session_followup_sent_at, project_availability_slots(slot_date, start_time, end_time, timezone, is_active, field_id, consultant_id)")
    .eq("status", "booked")
    .eq("session_status", "pending")
    .is("session_followup_sent_at", null)
    .limit(100);
  if (error) throw error;

  const now = new Date();
  const sent: unknown[] = [];
  const skipped: unknown[] = [];
  const errors: string[] = [];

  for (const booking of data || []) {
    const slot = booking.project_availability_slots as BookingSlotRow | null;
    if (!slot || slot.is_active !== true || String(slot.field_id || "") !== String(booking.field_id || "")) {
      skipped.push({ bookingId: booking.id, reason: "inactive slot" });
      continue;
    }
    const slotEnd = getSlotEndInstant(slot);
    if (!slotEnd || slotEnd > now) {
      skipped.push({ bookingId: booking.id, reason: "not due" });
      continue;
    }

    try {
      sent.push(await sendSessionFollowupForBooking(adminClient, trackerBaseUrl, booking as Record<string, string>));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${booking.id}: ${message}`);
      await adminClient
        .from("project_availability_bookings")
        .update({ session_followup_error: message, updated_at: new Date().toISOString() })
        .eq("id", booking.id);
    }
  }

  return { ok: errors.length === 0, sent, skipped, errors };
}

async function loadSessionFeedbackByToken(
  adminClient: ReturnType<typeof createClient>,
  token: string,
) {
  const tokenHash = await sha256Hex(token);
  const { data: booking, error } = await adminClient
    .from("project_availability_bookings")
    .select("id, project_id, record_id, field_id, slot_id, consultant_name, consultant_email, session_status, session_comment, session_status_submitted_at, session_followup_token_expires_at")
    .eq("session_followup_token_hash", tokenHash)
    .eq("status", "booked")
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;
  const expiresAt = booking.session_followup_token_expires_at ? new Date(booking.session_followup_token_expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) return null;
  const context = await loadBookingContext(adminClient, booking as Record<string, string>);
  return { booking, context };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const trackerBaseUrl = Deno.env.get("TRACKER_BASE_URL") ?? "https://tanastudio.github.io/ProjectTracker";
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let bookingId = "";
  try {
    const body = (await req.json()) as BookingNotifyBody;
    const action = body?.action || "send_booking_confirmation";

    if (action === "send_session_followups") {
      const cronSecret = (Deno.env.get("BOOKING_FOLLOWUP_CRON_SECRET") || Deno.env.get("PROJECT_UPDATE_CRON_SECRET") || "").trim();
      const cronHeader = (req.headers.get("x-booking-followup-cron-secret") || req.headers.get("x-project-update-cron-secret") || "").trim();
      const source = String(body?.source || "").trim().toLowerCase();
      const wantsCron = Boolean(cronHeader) || source === "cron";
      if (wantsCron && !cronSecret) {
        return json({ error: "BOOKING_FOLLOWUP_CRON_SECRET is not configured" }, 500);
      }
      const requestedByCron = wantsCron && cronHeader === cronSecret;
      if (!requestedByCron) return json({ error: "Unauthorized" }, 401);
      const result = await sendDueSessionFollowups(adminClient, trackerBaseUrl);
      return json(result, result.ok ? 200 : 207);
    }

    if (action === "get_session_feedback") {
      const token = String(body?.token || "").trim();
      if (!token) return json({ error: "token is required" }, 400);
      const loaded = await loadSessionFeedbackByToken(adminClient, token);
      if (!loaded) return json({ error: "This confirmation link is invalid or expired" }, 404);
      const { booking, context } = loaded;
      return json({
        ok: true,
        projectName: context.projectName,
        participantName: context.participantName,
        stepLabel: context.stepLabel,
        slotLabel: context.slotLabel,
        consultantName: context.consultantName,
        consultantEmail: context.consultantEmail,
        sessionStatus: booking.session_status || "pending",
        sessionStatusLabel: getSessionStatusLabel(booking.session_status),
        sessionComment: booking.session_comment || "",
        submittedAt: booking.session_status_submitted_at || null,
      });
    }

    if (action === "submit_session_feedback") {
      const token = String(body?.token || "").trim();
      const sessionStatus = String(body?.sessionStatus || "").trim().toLowerCase();
      if (!token) return json({ error: "token is required" }, 400);
      if (!["completed", "not_completed"].includes(sessionStatus)) {
        return json({ error: "sessionStatus must be completed or not_completed" }, 400);
      }
      const loaded = await loadSessionFeedbackByToken(adminClient, token);
      if (!loaded) return json({ error: "This confirmation link is invalid or expired" }, 404);
      const { booking, context } = loaded;
      const comment = cleanText(body?.comment, "").slice(0, 2000) || null;
      const submittedAt = new Date().toISOString();
      const { error: updateError } = await adminClient
        .from("project_availability_bookings")
        .update({
          session_status: sessionStatus,
          session_comment: comment,
          session_status_submitted_at: submittedAt,
          session_status_submitted_by_email: context.consultantEmail,
          session_followup_error: null,
          updated_at: submittedAt,
        })
        .eq("id", booking.id)
        .eq("status", "booked");
      if (updateError) throw updateError;

      await adminClient
        .from("records")
        .update({ updated_at: submittedAt })
        .eq("id", booking.record_id);

      return json({
        ok: true,
        sessionStatus,
        sessionStatusLabel: getSessionStatusLabel(sessionStatus),
        sessionComment: comment || "",
        submittedAt,
      });
    }

    bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) return json({ error: "bookingId is required" }, 400);

    const { data: booking, error: bookingError } = await adminClient
      .from("project_availability_bookings")
      .select("id, project_id, record_id, field_id, slot_id, consultant_name, consultant_email, notification_sent_at")
      .eq("id", bookingId)
      .eq("status", "booked")
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return json({ error: "Booking not found" }, 404);
    const caller = await getAuthenticatedCaller(adminClient, req);
    if (!caller?.id) return json({ error: "Unauthorized" }, 401);
    const callerProfile = await getCallerProfile(adminClient, caller.id);
    if (!(await canCallerAccessBooking(adminClient, booking as Record<string, unknown>, caller.id, callerProfile))) {
      return json({ error: "Forbidden" }, 403);
    }
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

    const projectName = cleanText(project?.name, "Project");
    const participantName = cleanText(record?.title, cleanText(record?.code, "Participant"));
    const stepLabel = cleanText(field?.label, "Booking");
    const slotLabel = formatSlotLabel(slot || {});
    const actionUrl = `${trackerBaseUrl}/participant-status.html`;
    const assignedConsultantEmail = String(booking.consultant_email || "").trim().toLowerCase();
    const consultantRecipients = isValidEmail(assignedConsultantEmail)
      ? [assignedConsultantEmail]
      : await getConsultantEmails(adminClient, booking.project_id, booking.field_id);
    const consultantName = cleanText(booking.consultant_name, assignedConsultantEmail || "Consultant");
    const targets = buildDeliveryTargets(recipient, participantName, consultantRecipients, consultantName);
    if (!targets.length) {
      await adminClient
        .from("project_availability_bookings")
        .update({ notification_error: "No email recipients found", updated_at: new Date().toISOString() })
        .eq("id", bookingId);
      return json({ ok: false, skipped: true, reason: "no email recipients found" });
    }
    const calendarInvite = buildCalendarInvite({
      bookingId,
      slot: slot || null,
      projectName,
      participantName,
      participantEmail: recipient,
      stepLabel,
      consultantName,
      consultantEmail: assignedConsultantEmail,
      actionUrl,
      attendees: targets,
      organizerEmail: Deno.env.get("NOTIFY_FROM_EMAIL") ?? DEFAULT_ORGANIZER_EMAIL,
    });

    const sent: Array<{ email: string; provider: string; role: string }> = [];
    const errors: string[] = [];
    for (const target of targets) {
      try {
        const result = await sendEmail({
          to: target.email,
          subject: `[Booking Confirmed] ${stepLabel} - ${projectName}`,
          title: "Booking confirmed",
          body: buildBodyForTarget(target, participantName, stepLabel, consultantName, slotLabel),
          actionUrl,
          actionText: target.role === "consultant" ? "View Booking" : "View My Status",
          projectName,
          participantName,
          participantEmail: recipient,
          stepLabel,
          slotLabel,
          consultantName,
          consultantEmail: assignedConsultantEmail || (target.role === "consultant" ? target.email : ""),
          recipientName: target.name,
          recipientRole: target.role,
          senderName: DEFAULT_SENDER_NAME,
          senderRole: DEFAULT_SENDER_ROLE,
          calendarInvite,
        });
        sent.push({ email: target.email, provider: result.provider, role: target.role });
      } catch (err) {
        errors.push(`${target.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length) {
      throw new Error(errors.join("; "));
    }

    await adminClient
      .from("project_availability_bookings")
      .update({ notification_sent_at: new Date().toISOString(), notification_error: null, updated_at: new Date().toISOString() })
      .eq("id", bookingId);

    return json({ ok: true, sent_to: sent.map((item) => item.email), sent });
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
