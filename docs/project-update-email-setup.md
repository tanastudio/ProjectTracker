# Project Update Email Setup

## What this feature does

- Sends an HTML project summary email to all project members whose profile role is `client`
- Uses the current dashboard-style snapshot:
  - total participants
  - completed
  - in progress
  - issue
  - not started
  - process breakdown by step
- Supports:
  - weekly schedules with one or more weekdays
  - monthly schedules with up to two dates
  - a configurable send time for both client and internal schedules
  - client `cc` and `bcc` email lists
  - a shared internal portfolio summary schedule across all active projects

## Supabase database setup

Run the new migration so these objects exist:

- `public.project_update_email_settings`
- `public.project_update_email_runs`
- minute-level cron bootstrap for `project-update-summary`

## Function secrets

Set these Edge Function secrets:

```bash
supabase secrets set \
  N8N_PROJECT_UPDATE_WEBHOOK_URL=https://your-n8n-host/webhook/... \
  TRACKER_BASE_URL=https://your-app-domain.com \
  PROJECT_UPDATE_CRON_SECRET=replace_with_a_long_random_secret
```

## Vault secrets for cron

The migrations will only create the minute-level cron job when these Vault secrets already exist:

```sql
select vault.create_secret('https://your-project-ref.supabase.co', 'project_url');
select vault.create_secret('replace_with_the_same_random_secret', 'project_update_cron_secret');
```

If the secrets are added after the migration has already run, re-run the cron section manually or apply the migration again in a fresh environment.

## n8n / email workflow requirements

The receiving webhook should read:

- `to_emails`
- `audit_emails`
- `original_cc_emails`
- `original_bcc_emails`
- `send_strategy`
- `recipient_group`
- `email_subject`
- `email_html`
- `message_body`
- `action_url`
- `action_text`

The workflow should send `email_html` as the final email body to preserve the dashboard-style layout.

Operationally, the project now sends:

- `to_emails` as the primary recipients that should be delivered in a loop, one email per recipient
- `audit_emails` as a separate optional recipient list for one audit copy after the main loop
- empty `cc_emails` / `bcc_emails` in the main payload to avoid AWS SES multi-recipient limitations in the current workflow

## Operational notes

- Automatic sends run in `Asia/Bangkok` using the time saved in `Project Settings > Client Updates`
- Manual sends can be triggered from `Project Settings > Client Updates`
- Client recipients are discovered dynamically from current project members with profile role `client`
- Internal recipients are discovered from the union of `internal` and `admin` members across all active projects
- Internal emails now send one combined portfolio summary for every active project in a single email
