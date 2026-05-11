# Project Update Email Production Rollout Checklist

This checklist is ordered so infrastructure dependencies are ready before the first real email send.

## 1. Database and Edge Function

- Apply the email schedule migrations in order:
  - `supabase/migrations/20260424100000_project_update_email_schedules.sql`
  - `supabase/migrations/20260424113000_project_update_email_send_times.sql`
- Deploy the `project-update-summary` Edge Function.
- Confirm the function bundle includes the shared helper:
  - `lib/project-update-email-utils.js`
- Verify the function can read:
  - `project_update_email_settings`
  - `project_update_email_runs`
  - `projects`
  - `project_members`
  - `profiles`
  - `fields`
  - `records`
  - `record_values`

## 2. Secrets and Runtime Config

- Set Supabase Edge Function secrets:
  - `N8N_PROJECT_UPDATE_WEBHOOK_URL`
  - `TRACKER_BASE_URL`
  - `PROJECT_UPDATE_CRON_SECRET`
- Confirm `TRACKER_BASE_URL` points to the production app domain, not localhost.
- Confirm the same `PROJECT_UPDATE_CRON_SECRET` value is used in both:
  - Edge Function secrets
  - Vault secret `project_update_cron_secret`

## 3. Vault and Cron

- Create Vault secrets:
  - `project_url`
  - `project_update_cron_secret`
- Make sure `project_url` is the full Supabase project URL, for example:
  - `https://<project-ref>.supabase.co`
- Confirm `pg_cron`, `pg_net`, and Vault are available in the target environment.
- Re-run the cron bootstrap SQL if the Vault secrets were added after the migrations.
- Verify the cron job exists and runs every minute.

## 4. n8n Webhook Contract

- Create or update the n8n webhook that receives project update payloads.
- The workflow must read these fields from the request body:
  - `to_emails`
  - `cc_emails`
  - `bcc_emails`
  - `email_subject`
  - `email_html`
  - `message_body`
  - `action_url`
  - `action_text`
  - `email_type`
  - `project_name`
  - `recipient_name`
  - `schedule_label`
- Send `email_html` as the final HTML body without stripping styles.
- Preserve `cc_emails` and `bcc_emails` as arrays.
- Do not collapse the internal portfolio email into plain text. It is already formatted by the Edge Function.

## 5. Mail Provider Setup

- Confirm the n8n email node uses the production SMTP provider or transactional email service.
- Set the sender identity used for client-facing emails.
- Confirm SPF, DKIM, and DMARC are configured for the sender domain.
- Verify the sender is allowed to send to external client addresses.

## 6. Application QA

- Open `Project Settings > Client Updates` in production.
- For one test project, verify:
  - client schedule can be enabled
  - weekdays can be selected
  - monthly dates can be selected
  - time picker values save correctly
  - CC and BCC save correctly
- Verify the `Immediately Send Report` button triggers one project-only client email.
- Verify the `Immediately Send Internal Report` button triggers one combined internal email across all active projects.
- Confirm the internal summary includes:
  - active project count
  - total participant count
  - per-project rows
  - dashboard links

## 7. Recipient QA

- Confirm client recipients come only from project members whose profile role is `client`.
- Confirm internal recipients are the union of all `internal` and `admin` members across active projects.
- Confirm a client who belongs to two projects receives separate project emails.
- Confirm internal recipients receive one combined portfolio email, not one email per project.

## 8. Scheduling QA

- Save a client schedule a few minutes ahead and verify it sends at the selected time.
- Save an internal schedule a few minutes ahead and verify the combined email sends once.
- Confirm no duplicate runs are created for the same project/date/group combination.
- Review `project_update_email_runs` after each test:
  - `status`
  - `recipients`
  - `cc_emails`
  - `bcc_emails`
  - `summary`
  - `error_message`

## 9. Observability and Recovery

- Add n8n error handling for failed email delivery.
- Add alerting or logging for:
  - non-2xx webhook responses
  - function execution failures
  - repeated cron failures
- Document who owns:
  - schedule configuration
  - n8n workflow maintenance
  - sender domain reputation
  - production incident response

## 10. Launch Gate

- Do not enable client schedules until:
  - n8n is deployed
  - SMTP is verified
  - secrets are set
  - cron is confirmed active
  - one manual client send succeeds
  - one manual internal send succeeds
- After launch, monitor the first scheduled sends and verify the resulting run logs.
