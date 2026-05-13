# Project Architecture And Code Review

Generated: 2026-05-13

## Scope

This document reviews the Project Tracker V3 codebase as a static browser application backed by Supabase. It covers frontend pages, shared browser modules, Supabase Edge Functions, database migrations, scripts, tests, assets, and operational documents.

The review intentionally excludes generated or private artifacts from detailed explanation:

- `node_modules/`: installed third-party packages.
- `vendor/supabase-js.js`: bundled Supabase browser client generated from `@supabase/supabase-js`.
- `*.log`: local runtime logs.
- `.env` and `supabase/functions/.env.local`: local secrets.
- `docs/private/`: private QA handoff data.
- binary manuals and images, except for their purpose in the project.

## Executive Summary

The project is a static multi-page web app. Each page is either a self-contained HTML file with inline module code or an HTML shell that loads a page-specific module. Supabase provides authentication, row-level security, storage of project/participant/ticket data, scheduled email configuration, booking availability, and Edge Functions for privileged tasks.

Current tests pass:

- `npm test`: 6 test files, 65 tests passed.
- `npm audit --omit=dev`: no production dependency vulnerabilities.
- `npm audit`: 7 dev dependency vulnerabilities, mostly via `vitest` and `vite`.

Main risks found:

- `form.js` only blocks `participant` and missing-profile users from Update Status. It does not block `client`, so a client can open `form.html` directly. If the client also has an editor project membership, database policies may allow writes.
- `ticket-notify`, `booking-notify`, and `project-update-summary` are deployed with JWT verification disabled. Some actions are intended to be public, but default notification actions use the service role without caller authorization.
- `admin-create-user` falls back to a known default participant password if `DEFAULT_PARTICIPANT_PASSWORD` is missing.
- Cron endpoints treat requests as cron when the secret is missing and a caller sends a cron-looking header/body.
- The frontend uses many `innerHTML` render paths and CSP allows `'unsafe-inline'`, which weakens XSS containment.
- `dashboard.html` loads Chart.js and xlsx from unpinned CDN URLs without SRI.
- The largest pages are too large for maintainable iteration: `project-settings.html` has 5,351 lines, `participant-status.html` has 2,945 lines, and `dashboard.js` has 1,660 lines.

## Runtime Model

The app is served as static files. There is no build step for the application itself. Browser modules import the shared Supabase client from `supabaseClient.js`, which imports environment selection from `js/config.js` and the bundled Supabase SDK from `vendor/supabase-js.js`.

Development scripts:

- `npm run dev`: serves the repository root on port 3000 with `serve`.
- `npm run build:supabase-client`: rebuilds `vendor/supabase-js.js` from the npm package.
- `npm test`: runs Vitest unit tests for shared helper modules.
- `npm run test:watch`: runs Vitest in watch mode.
- `npm run users:participants`: provisions participant users from data.
- `npm run users:test`: provisions a local test-user set.

Supabase local development is configured in `supabase/config.toml` with local API port `55321`, database port `55322`, Studio port `55323`, and Edge Runtime enabled.

## Frontend Page Map

### `index.html`

Purpose: login and password reset request page.

Main behavior:

- Imports `supabase` from `supabaseClient.js`.
- Validates email shape before sign-in.
- Calls `supabase.auth.signInWithPassword`.
- Loads the signed-in user's profile role.
- Redirects participants to `participant-status.html`.
- Redirects all other signed-in users to `projects.html`.
- Sends password reset email with redirect target `update-password.html`.
- Handles `?msg=password_updated` after a successful password change.

Risk notes:

- It relies on profile lookup after login. If profile read fails, it falls back to Projects.
- Password strength validation is limited to non-empty input at login and Supabase-side rules.

### `projects.html`

Purpose: project selection, project cards, and role-aware navigation.

Main behavior:

- Requires an active session.
- Loads user profile and role.
- Redirects participants to `participant-status.html`.
- Loads `project_members` for the signed-in user.
- Loads project summaries from `project_overall_summary`.
- Shows ticket unread/open counts through `lib/ticket-nav-badge.js`.
- Stores selected project id in `sessionStorage`.
- Routes users to Dashboard, Tickets, Update Status, Project Settings, or Admin pages.

Risk notes:

- Project Settings nav is visible for `internal` users in the sidebar, but `project-settings.html` applies a stricter internal editor check. This creates a redirect-only UX for internal viewers.
- The page depends on client-side role visibility. Database RLS remains the real access control.

### `dashboard.html` and `dashboard.js`

Purpose: project dashboard with status charts, participant table, ticket stats, CSV/XLSX export, and request modal.

Main behavior:

- `dashboard.html` provides layout, Chart.js CDN script, xlsx CDN script, and loads `dashboard.js`.
- `dashboard.js` requires a session and rejects participants.
- Resolves the selected project from URL or `sessionStorage`.
- Loads fields, records, record values, active bookings, tickets, ticket read states, and replies.
- Builds a participant model for summary charts and table rows.
- Renders overall status and process charts.
- Exports visible dashboard rows to CSV or XLSX.
- Creates support requests and invokes `ticket-notify`.
- Maintains dashboard tab state in `sessionStorage`.

Performance notes:

- `dashboard.js:323` uses `.select("*")` for `record_values`.
- It loads records and values for the full project and renders the whole table client-side.
- Ticket unread counts require ticket, read-state, and reply queries.
- Chart.js and xlsx are loaded on every dashboard visit, even when export is not used.

Security notes:

- CDN scripts are unpinned and do not use SRI.
- Extensive `innerHTML` use is mostly escaped but increases XSS review burden.

### `form.html` and `form.js`

Purpose: internal/admin participant status update screen.

Main behavior:

- `form.html` provides layout and loads `form.js`.
- `form.js` loads profile, project membership, fields, records, record values, and bookings.
- Builds editable row models for participant code, name, email, issue, decision, and dynamic step fields.
- Computes local overall status using `lib/form-utils.js`.
- Saves changed record values and base record data back to Supabase.
- Supports adding a new participant directly.
- Uses a participant picker, filters, sorting, dirty-state tracking, and horizontal scroll sync.

High-priority issue:

- `form.js:73-91` only redirects `participant` and `external` users. It does not reject `client`, even though the QA guide says clients must not access Update Status. A client opening `form.html?project=...` directly can load the page. If that client has an editor project membership, the `can_edit_project`/`can_edit_record` policy path can permit writes.

Performance notes:

- `form.js:355` uses `.select("*")` for `record_values`.
- The page renders all participant rows and all dynamic fields client-side.

### `participant-status.html`

Purpose: participant-facing status, booking, and support ticket view.

Main behavior:

- Requires a session.
- Loads the profile and resolves the participant's own `participant_record_id`.
- Supports an admin preview mode guarded by admin role and `preview_record`.
- Loads participant record, fields, record values, booking settings, available slots, and current bookings.
- Renders status cards and booking calendars.
- Books an availability slot through `book_project_availability_slot_v2`.
- Invokes `booking-notify` after booking.
- Creates participant support tickets and invokes `ticket-notify`.
- Shows ticket replies and supports participant replies.

Risk notes:

- It is a very large single HTML file with page code embedded inline.
- Booking logic, ticket logic, auth logic, rendering, and calendar behavior should be split into modules.

### `tickets.html`

Purpose: project ticket list, detail rows, replies, status/priority/owner updates, and read states.

Main behavior:

- Requires a session and selected project membership.
- Loads profile role.
- Loads ticket rows and replies.
- Uses `lib/ticket-utils.js` for status and priority normalization.
- Uses `update_ticket` RPC for column-level status/priority/owner updates.
- Uses `ticket_read_states` to mark tickets as seen.
- Invokes `ticket-notify` for replies and updates.

Security notes:

- Direct table updates are narrowed by migration `20260408000000_harden_ticket_update.sql`.
- The RPC allows client users to change priority but not status or owner, which matches current page behavior.

### `admin.html`

Purpose: admin landing page with KPIs, shortcuts, and participant preview helper.

Main behavior:

- Requires admin role.
- Loads counts from Supabase with head-count queries.
- Provides links to access management, audit logs, project pages, and create project.
- Lets admin select a project and participant record, then opens participant preview.

Risk notes:

- KPI queries are simple and safe, but the page duplicates auth/sidebar code that exists in other pages.

### `admin-access.html`

Purpose: admin-only user role and project membership management.

Main behavior:

- Requires admin role.
- Loads profiles, projects, and project memberships.
- Updates profile role and display name.
- Adds/removes/updates project memberships through direct `project_members` writes.

Security notes:

- Later migrations restrict `project_members` writes to admins, which matches this page.
- Profile updates are powerful and should remain admin-only.

### `admin-audit.html`

Purpose: admin-only audit log viewer.

Main behavior:

- Requires admin role.
- Loads profile and project filter options.
- Loads `audit_logs`, resolves affected user display information, and renders changed fields.
- Uses `lib/audit-utils.js` for actor/user/action formatting.

Risk notes:

- Audit display logic is reasonably isolated through shared helpers.
- Query scope should remain admin-only through RLS.

### `create-project.html`

Purpose: admin project creation wizard.

Main behavior:

- Requires admin role.
- Saves draft data in `localStorage`.
- Lets admins configure project details, reusable/custom fields, members, and participant CSV import.
- Creates the project, inserts fixed and custom fields, adds project members, and imports participants through `admin-create-user`.
- Redirects to dashboard on success or project settings if partial setup fails.

Issues and improvement notes:

- CSV parsing is naive and uses `split(",")`, so quoted commas and escaped quotes will parse incorrectly.
- Participant import is sequential, which is safer for rate limits but slow for large CSVs.
- Draft persistence in `localStorage` can retain project/member draft data on shared browsers.

### `project-settings.html`

Purpose: project admin/internal editor configuration surface.

Main behavior:

- Requires admin role or internal editor/creator access.
- Loads and edits general project details.
- Manages project update email settings and send history.
- Configures booking availability, booking steps, consultants, and preview calendars.
- Manages project fields, reusable field library, custom field creation, and field ordering.
- Lets admins manage project members and reset member passwords.
- Lets authorized users import participants through `admin-create-user`.

Important access split:

- Project settings page access allows admin and qualified internal users.
- Project member management is restricted in the UI to admins only through `canManageProjectMembers`.
- Database migrations also restrict direct `project_members` writes to admins.

Issues and improvement notes:

- This file is 5,351 lines and mixes auth, routing, project details, email schedules, availability, fields, member management, password resets, CSV import, rendering, and dialogs.
- `project-settings.html:1626` loads the full project row through `.select("*")`.
- `get_project_field_library_for_settings` orders `DISTINCT ON (f.key)` by `(f.project_id = p_project_id)` ascending. That prefers non-current-project rows before current-project rows for duplicate keys.

### `booking-session-feedback.html`

Purpose: public consultant session feedback page opened from booking follow-up email.

Main behavior:

- Reads a public `token` query parameter.
- Calls `booking-notify` with anon authorization for `get_session_feedback`.
- Renders session details.
- Submits `completed` or `not_completed` with optional comment through `booking-notify`.

Security notes:

- Public token access is intentional.
- The Edge Function stores only the token hash in the database and checks expiry.

### `update-password.html`

Purpose: password recovery landing page.

Main behavior:

- Reads `token_hash` and `type` from URL.
- Calls `supabase.auth.verifyOtp`.
- Removes auth params from URL.
- Lets the user set a new password.
- Requires only length >= 8 at the UI level.
- Signs the user out and redirects to login after success.

### `test-login.html` and `test-users.js`

Purpose: local/QA user switching helper.

Main behavior:

- Loads `test-users.js`.
- Renders known test users.
- Stores typed passwords in `localStorage` by role.
- Signs out the current user, signs in selected user, then routes to Projects.

Security note:

- This page should not be deployed to production. It enumerates known test accounts and stores passwords in browser storage.

## Shared Browser Modules

### `supabaseClient.js`

Creates and exports the Supabase browser client:

- Imports `createClient` from `vendor/supabase-js.js`.
- Imports URL and anon key from `js/config.js`.
- Exports `supabase`.

### `js/config.js`

Selects Supabase environment:

- Reads `?supabase=local` or `?supabase=remote`.
- Persists the choice in `localStorage`.
- Defaults to the remote Supabase project.
- Exports `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_ENVIRONMENT`.

Security note:

- The anon key is public by design, but the remote project reference and anon key are hard-coded into the frontend. RLS must be treated as the security boundary.

### `js/sanitize.js`

Exports `escapeHtml(value)`, which escapes `&`, `<`, `>`, `"`, and `'`. This is used in render paths that need HTML strings.

### `lib/form-utils.js`

Pure status logic:

- `STEP_STATUS`: canonical default step statuses.
- `normalizeStatus`: validates a status against field options or defaults.
- `computeOverall`: computes overall status with priority `Issue`, `Completed`, `In Progress`, `Not Started`.

### `lib/booking-utils.js`

Pure booking/date/time helpers:

- Detects booking fields through explicit `field_role` or legacy key/label matching.
- Defines known time zones.
- Builds booking map keys.
- Converts date/time values between time zones.
- Formats slot date/time, booking date/time, and session status labels.

### `lib/ticket-utils.js`

Pure ticket helpers:

- Normalizes ticket status to `open` or `done`.
- Normalizes priority to `low`, `normal`, `high`, or `urgent`.
- Formats notification event labels.
- Performs loose email validation.
- Decides whether status/priority notifications should fire.

### `lib/ticket-nav-badge.js`

Ticket unread/open badge behavior:

- Computes unread state from ticket creation/reply activity and `ticket_read_states`.
- Loads tickets, read states, and replies for one or more projects.
- Adds or updates `.nav-ticket-badge` inside a navigation element.

Performance note:

- Badge refresh does three queries and loads all replies for visible ticket ids. For large projects, an RPC/view that returns per-project unread counts would be more efficient.

### `lib/audit-utils.js`

Audit display helpers:

- Normalizes audit action labels/classes.
- Formats audit actors.
- Resolves affected user id from `audit_logs` rows for profiles, project members, assignments, and common user-id fields.
- Formats changed-field lists.

### `lib/project-update-email-utils.js`

Project update schedule helpers:

- Defines weekly/monthly schedule types and weekdays.
- Normalizes weekdays, month days, clock fields, schedule type, monthly mode, and timezone.
- Validates enabled schedules.
- Produces human-readable schedule descriptions.

### `lib/admin-utils.js`

Admin Edge Function testable helpers:

- `validateInput`: validates participant provisioning input.
- `findAuthUserByEmail`: paginates through `auth.admin.listUsers` to locate an existing auth user.

### `lib/toast-notifications.js`

DOM toast helpers:

- Creates a toast root when needed.
- Renders success/error toasts with ARIA roles.
- Removes toasts after a timeout.
- Clears all toasts.

## Supabase Edge Functions

### `admin-create-user`

Purpose: privileged participant auth-user provisioning.

Main behavior:

- Requires POST.
- Supabase config has `verify_jwt = true`.
- Verifies the caller by reading the Authorization header with an anon client.
- Allows admin or internal project editor/creator to provision for a project.
- Creates or reuses an auth user.
- Upserts the participant profile.
- Creates or reuses a participant record.
- Saves email into the email field's `record_values`.
- Adds project membership.
- Writes an audit log.

High-priority issue:

- If `DEFAULT_PARTICIPANT_PASSWORD` is missing, it falls back to `Mentis2026!`. Production should fail closed instead of using a known password.

### `admin-reset-password`

Purpose: admin-only direct password reset for project members.

Main behavior:

- Requires POST.
- Supabase config has `verify_jwt = true`.
- Verifies caller token.
- Requires caller profile role `admin`.
- Requires target user to be a member of the project.
- Calls `auth.admin.updateUserById`.
- Writes an audit log.

Risk note:

- Password validation is length-only. Stronger password policy should be enforced by Supabase Auth settings, not only UI/function checks.

### `ticket-notify`

Purpose: ticket email notification delivery through n8n or Resend.

Main behavior:

- Supabase config has `verify_jwt = false`.
- Reads ticket context using service-role client.
- Derives recipients from project members, participant email, author role, and ticket data.
- Sends email through n8n first, then Resend fallback.

High-priority issue:

- The function performs no caller authorization. Anyone who can call the Edge Function and knows or guesses a ticket id can trigger notification delivery for that ticket.

### `booking-notify`

Purpose: booking confirmation emails, scheduled session follow-ups, and public session feedback token handling.

Main behavior:

- Supabase config has `verify_jwt = false`.
- Default action sends booking confirmation emails for a booking id.
- `send_session_followups` is intended for cron.
- `get_session_feedback` and `submit_session_feedback` are public token flows.
- Uses service role for booking, record, project, slot, and consultant lookups.
- Sends emails through n8n or Resend.

High-priority issue:

- Default booking confirmation action has no caller authorization. A caller with a booking id can trigger or affect notification state.

Cron issue:

- If neither `BOOKING_FOLLOWUP_CRON_SECRET` nor `PROJECT_UPDATE_CRON_SECRET` is configured, a request with a cron-looking header and `source: "cron"` is treated as cron.

### `project-update-summary`

Purpose: manual and scheduled project update emails for client and internal recipient groups.

Main behavior:

- Supabase config has `verify_jwt = false`.
- Manual requests verify the Bearer token and project management permission.
- Cron requests use `x-project-update-cron-secret`.
- Loads project update settings, recipients, fields, records, and record values.
- Builds HTML/text summaries.
- Sends through n8n.
- Records runs in `project_update_email_runs`.

High-priority issue:

- If `PROJECT_UPDATE_CRON_SECRET` is missing, a request with a non-empty cron header and `source: "cron"` bypasses manual user authorization.

Performance note:

- Scheduled cron runs every minute and then checks local schedule due-ness in code. This is flexible but can be noisy as data grows.

## Database Model

Core tables:

- `profiles`: application profile for each Supabase Auth user, including role and participant record link.
- `projects`: project metadata and status.
- `project_members`: user membership and access role per project.
- `fields`: dynamic project field definitions.
- `records`: participant records.
- `record_values`: dynamic field values per record.
- `requests`: support tickets.
- `ticket_replies`: ticket reply thread.

Additional tables introduced by migrations:

- `client_record_assignments`: legacy/optional explicit client-record assignments.
- `ticket_read_states`: per-user ticket read state.
- `audit_logs`: database and privileged action audit trail.
- `project_update_email_settings`: email schedule configuration.
- `project_update_email_runs`: email run history.
- `project_availability_slots`: bookable availability slots.
- `project_availability_bookings`: participant bookings and session follow-up state.
- `project_availability_step_settings`: per-booking-step settings.
- `project_availability_consultants`: booking consultants per step.

Views:

- `project_overall_summary`: per-project participant status counts, using `security_invoker = true`.

Important database functions:

- Access helpers: `current_profile_role`, `current_participant_record_id`, `is_admin`, `is_internal`, `is_project_creator`, `is_project_member`, `can_edit_project`, `can_access_project`, `can_access_record`, `can_edit_record`, `can_access_request`.
- Participant code: `generate_participant_code`.
- Ticket update: `update_ticket`.
- Ticket read state: `mark_project_tickets_seen`.
- Audit: `audit_changed_fields`, `audit_entity_id`, `audit_project_id`, `audit_table_change`, `install_audit_trigger`.
- Overall status: `compute_overall_status_for_record`, `refresh_overall_status_for_record`, `refresh_overall_status_for_project`.
- Booking: `get_project_availability_slots`, `book_project_availability_slot`, `book_project_availability_slot_v2`, `replace_project_availability_consultants`, `cancel_project_availability_booking`, `remove_project_availability_slot`.
- Settings support: `get_project_members_for_settings`, `get_project_field_library_for_settings`, `get_project_global_consultant_availability_slots_for_settings`.

RLS model:

- RLS is enabled for core app tables.
- Frontend role hiding is not the security boundary.
- Admins generally have broad access.
- Internal/client project access is project-member based.
- Participants are restricted to their own participant record and related tickets.
- Direct `requests` updates were hardened so non-admin ticket changes go through `update_ticket`.
- Direct `project_members` writes were later restricted to admin only.

## Scripts

### `provision-users.mjs`

Service-role provisioning script for local or controlled environments:

- Creates a Supabase admin client from environment variables.
- Lists Auth users with pagination.
- Ensures auth users, profiles, project memberships, and participant links.
- Supports participant provisioning and full test-user provisioning.
- Uses namespaced local test emails for local environments.

### `create-participant-users.mjs`

Compatibility wrapper that imports `provision-users.mjs` and runs participant mode.

### `provision-local-test-users.mjs`

Compatibility wrapper that imports `provision-users.mjs` and runs local test-user mode.

### `cleanup-local-example-users.mjs`

Local cleanup helper for example users.

### `scripts/bootstrap-local-demo-data.mjs`

Seeds local demo projects, fields, records, values, admin user, and demo users using a service role key.

### `scripts/relink-local-participant-profiles.mjs`

Local repair helper for participant profile to participant record links.

## Styles And Assets

CSS files:

- `styles.css`: shared global and page styling.
- `sidebar.css`: shared sidebar/navigation styling.
- `dashboard.css`: dashboard-specific styles.
- `form.css`: Update Status-specific styles.

Assets:

- `favicon/`: web app manifest and favicon variants.
- `favicon.ico`: root favicon copy.
- `participants-template.csv`: sample participant import CSV.

Legacy/utility files:

- `NamespaceAdder.cs`, `NamespaceAdder_content.txt`, `CsvImporter_modified.txt`: unrelated or legacy Unity/C# helper artifacts. They are not used by the website runtime.

## Tests

Vitest configuration:

- `vitest.config.js` uses Node environment and includes `tests/**/*.test.js`.

Tested modules:

- `tests/form-utils.test.js`: status normalization and overall status.
- `tests/booking-utils.test.js`: booking field detection, time zones, date/time formatting, session status labels.
- `tests/ticket-utils.test.js`: ticket status/priority/event/email/notification rules.
- `tests/admin-utils.test.js`: admin input validation and user pagination.
- `tests/audit-utils.test.js`: audit label/user/field formatting.
- `tests/project-update-email-utils.test.js`: schedule normalization, validation, and descriptions.

Current gap:

- Browser page behavior, auth redirects, RLS integration, Edge Functions, booking flows, ticket flows, and CSV import are not covered by automated tests.

## Findings

### Bugs Or Unintended Behavior

1. High: clients can open Update Status directly.
   - Location: `form.js:73-91`.
   - Expected: only admin/internal users should access Update Status.
   - Actual: only `participant` and `external` are blocked. `client` is allowed through the page guard.
   - Impact: client viewers can see an edit surface; client editor memberships may be able to write through RLS.
   - Recommended fix: require role in `["admin", "internal"]` at the page guard and verify project member/editor rules for actions that need writes.

2. High: public notification functions can be triggered without caller authorization.
   - Locations: `supabase/config.toml` for `ticket-notify` and `booking-notify`, plus function bodies.
   - Impact: known ticket/booking ids can be used to trigger email sends or alter notification state.
   - Recommended fix: split public token actions from authenticated notification actions, or require a signed user token/action secret for notification sends.

3. High: cron authorization can fail open when the Edge Function secret is missing.
   - Locations: `project-update-summary/index.ts` and `booking-notify/index.ts`.
   - Impact: cron-like requests can bypass manual auth if secrets are not configured.
   - Recommended fix: if the expected cron secret is empty, return 500/401 and do not run cron actions.

4. High: participant provisioning has a known default password fallback.
   - Location: `admin-create-user/index.ts`.
   - Impact: missing production secret creates participant accounts with a known password.
   - Recommended fix: require `DEFAULT_PARTICIPANT_PASSWORD` and fail when absent.

5. Medium: field library ordering can select a non-current project field for duplicate keys.
   - Location: `20260513040000_project_field_library_for_settings.sql`.
   - Impact: reusable field labels/options can be surprising when multiple projects share the same key.
   - Recommended fix: sort current-project rows first if current project values should win, or explicitly exclude current-project fields from reusable library rows.

6. Medium: CSV import parsing is incomplete.
   - Locations: `create-project.html`, `project-settings.html`.
   - Impact: CSV values containing quoted commas or escaped quotes can import incorrectly.
   - Recommended fix: use a small CSV parser or a tested parser utility.

7. Medium: project settings and dashboard use broad `select("*")`.
   - Locations: `dashboard.js:323`, `form.js:355`, `project-settings.html:1626`.
   - Impact: unnecessary payload, accidental dependency on new columns, and higher exposure if columns are added.
   - Recommended fix: select explicit columns only.

### Performance Improvements

1. Defer xlsx loading until the user chooses Excel export.
2. Pin and self-host Chart.js and xlsx, or bundle fixed versions.
3. Replace full-project dashboard/form loads with paginated or RPC-backed queries.
4. Add a per-project ticket unread count RPC/view to replace multiple badge queries.
5. Avoid full DOM rerenders for large participant tables. Use keyed row updates or virtualization.
6. Move expensive project-update summary aggregation closer to SQL or cache recent summaries.
7. Reduce scheduled email cron frequency if minute-level precision is not required.
8. Remove or ignore `.temp`, logs, and local generated files from review/deploy artifacts.

### Refactor Targets

1. Split `project-settings.html` into modules:
   - auth/routing
   - project general settings
   - email schedules/history
   - availability calendar/slots
   - field management
   - member management
   - participant import
   - shared dialogs

2. Split `participant-status.html` into modules:
   - auth/profile resolution
   - status rendering
   - booking calendar
   - ticket panel
   - admin preview

3. Extract shared auth and sidebar code:
   - session guard
   - role loading
   - selected project handling
   - logout
   - role-based nav visibility

4. Extract shared table/filter/export helpers from Dashboard and Update Status.

5. Centralize HTML rendering conventions:
   - prefer DOM construction for interactive rows
   - use `escapeHtml` for any HTML string path
   - isolate trusted SVG/icon templates from data rendering

6. Add service modules for Supabase queries:
   - `projectsService`
   - `recordsService`
   - `ticketsService`
   - `bookingService`
   - `settingsService`

### Complexity Reduction

1. Replace role checks scattered across pages with a small shared permission matrix.
2. Replace repeated `sessionStorage` selected-project logic with one helper.
3. Replace duplicated support ticket notification payload builders with one helper.
4. Keep dynamic field interpretation in one module so Dashboard, Form, Participant Status, and Email Summary use the same rules.
5. Move CSV parsing/import validation into a pure tested module.
6. Keep Edge Function request validation in shared pure functions where possible.
7. Add integration tests for role guard expectations from the QA guide.

### Security Risks

1. Public Edge Functions with service-role access need stricter action-level authorization.
2. Known fallback participant password must be removed.
3. Cron secrets must be mandatory for cron paths.
4. `test-login.html` and `test-users.js` should not be deployed to production.
5. CSP uses `'unsafe-inline'`, so XSS containment is weak.
6. CDN scripts are unpinned and have no SRI.
7. Many `innerHTML` paths increase XSS review burden.
8. Password complexity is mostly length-only in local UI/function checks.
9. Dev dependency audit has known vulnerabilities. These are not production runtime dependencies, but they affect local tooling.

## Recommended Next Steps

1. Fix the Update Status role guard first.
2. Make cron secrets fail closed.
3. Require `DEFAULT_PARTICIPANT_PASSWORD` in `admin-create-user`.
4. Add authorization to `ticket-notify` and default `booking-notify` actions.
5. Remove `test-login.html` and `test-users.js` from production deployment or gate them by environment.
6. Replace broad `select("*")` calls with explicit columns.
7. Add Playwright or Supabase integration tests for the QA role matrix.
8. Start refactoring with `project-settings.html`, because it has the highest complexity and blast radius.

## Verification Performed

Commands run:

```bash
npm test
npm audit --omit=dev --json
npm audit --json
```

Results:

- Unit tests passed: 65/65.
- Production dependency audit found 0 vulnerabilities.
- Full dependency audit found 7 dev vulnerabilities:
  - 1 high through `fast-uri`.
  - 6 moderate through `vitest`, `vite`, `vite-node`, `@vitest/mocker`, `esbuild`, and `postcss`.

