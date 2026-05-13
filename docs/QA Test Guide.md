# Project Tracker QA Test Guide

## Purpose

Use this guide to review Project Tracker before wider rollout. The goal is to confirm that each role can access the right screens, complete normal workflows, and that audit logs capture meaningful user activity.

## Test Environment

- App URL: https://tanastudio.github.io/ProjectTracker/
- Scope: remote Supabase environment currently connected to the deployed app.
- Test accounts: use the private QA account note outside the deployable app bundle.
- Reference manuals:
  - `docs/Project_Tracker_Manual_TH.doc`
  - `docs/Project_Tracker_Manual_TH.html`

## Roles To Cover

- Admin: can manage projects, access management, settings, audit logs, tickets, and status updates.
- Internal: can update participant/project status and work on tickets for assigned projects.
- Client: can view assigned project information and create/follow tickets.
- Participant: can view their own participant-facing status and create/follow tickets related to their record.

## Recommended Browsers And Devices

Test at minimum:

- Chrome latest on desktop
- Edge latest on desktop
- Safari or Chrome on mobile, if available

Recommended viewport checks:

- Desktop: 1440px wide or larger
- Laptop: 1366px wide
- Mobile: 390px wide or similar

## Test Preparation

Before testing:

- Open the test account file and assign accounts to testers.
- Use only the provided test accounts.
- Do not enter real customer, employee, participant, or client data.
- Keep screenshots or screen recordings for any issue.
- Record the exact account, project, and page URL for every issue.
- If a test changes data, note what was changed so later testers understand the state.

## Priority Definitions

- Blocker: prevents login, prevents a core role from working, or exposes data to the wrong role.
- High: breaks a major workflow such as status update, ticket workflow, admin access, or audit log review.
- Medium: workflow works but has confusing behavior, missing validation, or incorrect display.
- Low: typo, cosmetic issue, minor layout issue, or non-blocking usability concern.

## Test Summary Matrix

| Area | Admin | Internal | Client | Participant |
| --- | --- | --- | --- | --- |
| Login/logout | Required | Required | Required | Required |
| Project list | Required | Required | Required | Participant should redirect to participant view |
| Dashboard | Required | Required | Required if assigned | Not expected |
| Update Status | Required | Required | Not allowed | Not allowed |
| Tickets | Required | Required | Required | Required |
| Admin Home | Required | Not allowed | Not allowed | Not allowed |
| Access Management | Required | Not allowed | Not allowed | Not allowed |
| Project Settings | Required | Not allowed unless explicitly granted | Not allowed | Not allowed |
| Audit Logs | Required | Not allowed | Not allowed | Not allowed |

## Detailed Test Cases

### TC-01 Login With Valid Accounts

Roles: Admin, Internal, Client, Participant

Steps:

1. Open the app URL.
2. Login using a valid test account for the role.
3. Wait for the first page to load.
4. Confirm the displayed user name/role is correct where shown.

Expected result:

- Valid users can login successfully.
- Admin/Internal/Client users land on the project experience.
- Participant users land on the participant-facing status page or are redirected there.
- No console error or blank page appears.

### TC-02 Login With Invalid Password

Roles: Any

Steps:

1. Open the login page.
2. Enter a valid email with an incorrect password.
3. Submit the login form.

Expected result:

- Login is rejected.
- A clear error message is shown.
- The user remains logged out.

### TC-03 Logout

Roles: Admin, Internal, Client, Participant

Steps:

1. Login.
2. Click Logout.
3. Use the browser back button.

Expected result:

- User returns to the login page.
- Back navigation does not restore an authenticated page.
- Protected pages redirect to login when no session exists.

### TC-04 Sidebar Visibility By Role

Roles: Admin, Internal, Client

Steps:

1. Login with each role.
2. Review the sidebar navigation items.
3. Compare visible links against the role matrix above.

Expected result:

- Admin sees admin-only links.
- Internal sees operational links but not admin-only links.
- Client sees client-appropriate links only.
- Restricted links are hidden or inaccessible.

### TC-05 Direct URL Permission Check

Roles: Internal, Client, Participant

Steps:

1. Login as a non-admin role.
2. Manually open these URLs:
   - `/admin.html`
   - `/admin-access.html`
   - `/admin-audit.html`
   - `/project-settings.html`
3. Observe the result.

Expected result:

- Non-admin users cannot use admin-only pages.
- The app redirects or blocks access without exposing sensitive data.

### TC-06 Project List And Assignment

Roles: Admin, Internal, Client

Steps:

1. Login.
2. Open Projects.
3. Confirm visible projects match the test account assignment.
4. Open each available project.

Expected result:

- Users only see projects they should access.
- Project cards show meaningful status/count information.
- Project navigation works without broken links.

### TC-07 Dashboard Load

Roles: Admin, Internal, Client

Steps:

1. Select an assigned project.
2. Open Dashboard.
3. Review charts, status counts, table/list content, and ticket badges.

Expected result:

- Dashboard loads without errors.
- Counts and charts are visible.
- Empty states are clear if no data exists.
- The selected project name/context is correct.

### TC-08 Participant Status Update

Roles: Admin, Internal

Steps:

1. Open an assigned project.
2. Go to Update Status.
3. Pick a participant row.
4. Change a non-critical test field or status.
5. Save/update the change.
6. Return to Dashboard and participant-facing view if available.

Expected result:

- The change saves successfully.
- Updated value appears after refresh.
- Dashboard summary updates where applicable.
- Audit Logs record the update.

### TC-09 Client Cannot Edit Participant Status

Roles: Client

Steps:

1. Login as a client account.
2. Attempt to open Update Status directly.
3. Attempt any visible edit action on participant/project data.

Expected result:

- Client cannot edit participant status.
- Restricted pages/actions are blocked.
- Read-only views remain accessible where expected.

### TC-10 Participant View

Roles: Participant

Steps:

1. Login as a participant account.
2. Review the participant-facing status page.
3. Confirm the page shows only the participant's own record.
4. Try direct access to Projects, Dashboard, Admin, or Update Status URLs.

Expected result:

- Participant sees only their own participant status.
- Participant cannot see other participants or admin/project management pages.
- Restricted URLs redirect or deny access.

### TC-11 Create Ticket

Roles: Participant, Client, Admin, Internal

Steps:

1. Open Tickets or participant ticket area.
2. Create a new ticket with a clear test subject.
3. Submit the ticket.
4. Refresh the page.

Expected result:

- Ticket is created.
- Ticket appears in the ticket list.
- Creator, subject, message, status, and project/participant context are correct.
- Audit Logs record ticket creation where applicable.

### TC-12 Reply To Ticket

Roles: Admin, Internal, Client, Participant

Steps:

1. Open an existing ticket relevant to the role.
2. Add a reply.
3. Refresh the ticket.

Expected result:

- Reply is saved and displayed in correct order.
- Author name/role is correct.
- Users can only view/reply to tickets they are allowed to access.

### TC-13 Ticket Status, Priority, And Owner

Roles: Admin, Internal, Client

Steps:

1. Open a ticket as Admin or Internal.
2. Change status.
3. Change priority.
4. Assign or unassign owner if available.
5. Repeat with Client for allowed fields only.

Expected result:

- Admin/Internal can update status and owner where allowed.
- Client can only update allowed ticket fields.
- Participant cannot manage administrative ticket fields.
- Updates persist after refresh.
- Audit Logs record the changes.

### TC-14 Ticket Badge And Read State

Roles: Admin, Internal, Client

Steps:

1. Create or update a ticket from another account.
2. Login with a user who should see that ticket.
3. Check sidebar ticket badge.
4. Open Tickets and view the ticket.
5. Return to another page and check the badge again.

Expected result:

- Badge appears when there are unread tickets.
- Badge count/state updates after viewing.
- Badge does not show tickets outside the user's access scope.

### TC-15 Admin Access Management

Roles: Admin

Steps:

1. Open Access Management.
2. Search/review users.
3. Change a test user's display name or role.
4. Add or update project membership for a test user.
5. Remove a membership only if it is safe for the test plan.

Expected result:

- Changes save successfully.
- Updated role/membership takes effect after re-login or refresh.
- Audit Logs capture profile and membership changes.

### TC-16 Project Settings

Roles: Admin

Steps:

1. Open Project Settings for a test project.
2. Review editable project details.
3. Update a safe field such as description or field label.
4. Add or reorder a field if required by the test pass.
5. Refresh Dashboard and Update Status.

Expected result:

- Settings changes save.
- Related pages reflect the new configuration.
- No data outside the selected project is affected.
- Audit Logs capture settings changes.

### TC-17 Admin Audit Logs

Roles: Admin

Steps:

1. Perform a known action such as updating a participant status or changing a test user's membership.
2. Open Audit Logs.
3. Confirm the new log entry appears.
4. Filter by User, Project, Area, and Action.
5. Clear filters.

Expected result:

- Audit Logs show the correct user name, action, area, project, entity, and summary.
- Filters return expected entries.
- Clearing filters restores the latest log list.

### TC-18 Audit Logs Non-Admin Restriction

Roles: Internal, Client, Participant

Steps:

1. Login as a non-admin user.
2. Open `/admin-audit.html` directly.

Expected result:

- User cannot view audit logs.
- App redirects or blocks access.

### TC-19 Responsive Layout

Roles: Admin, Internal, Client, Participant

Steps:

1. Test key pages on desktop width.
2. Resize to mobile width or use a mobile device.
3. Check login, project list, dashboard, ticket list, participant page, and admin pages where applicable.

Expected result:

- Text does not overlap.
- Buttons remain usable.
- Tables are scrollable where needed.
- Sidebar/header layout remains understandable.

### TC-20 Refresh And Session Persistence

Roles: Admin, Internal, Client, Participant

Purpose:

Confirm that the app keeps the user logged in after refreshing a page, and that restricted pages still protect access correctly.

Steps:

1. Login.
2. Open one page that the logged-in role is allowed to use.
3. Refresh the browser.
4. Confirm the page still loads and the user is still logged in.
5. Close and reopen the tab if practical.

What "protected page" means:

A protected page is any page that should only work after login. Some protected pages are available to all logged-in users, while some are admin-only.

Pages to test by role:

- Admin users:
  - Projects: `projects.html`
  - Dashboard for a selected project
  - Tickets for a selected project
  - Admin Home: `admin.html`
  - Access Management: `admin-access.html`
  - Audit Logs: `admin-audit.html`
  - Create Project: `create-project.html`
  - Project Settings for a selected project
  - Update Status for a selected project
- Internal users:
  - Projects: `projects.html`
  - Dashboard for an assigned project
  - Tickets for an assigned project
  - Update Status for an assigned project
- Client users:
  - Projects: `projects.html`
  - Dashboard for an assigned project
  - Tickets for an assigned project
- Participant users:
  - Participant Status page
  - Tickets or ticket section available from the participant view

Notes:

- For project-specific pages, testers do not need to type `project_id` manually.
- Select a project from the Projects page, then use the sidebar or buttons to open Dashboard, Tickets, Update Status, or Project Settings.
- If a tester copies a direct URL, `project_id` means the long project identifier already included in the URL after selecting a project.

Expected result:

- Session persists where expected.
- Page reload does not lose selected project unexpectedly.
- If session expires, user is redirected to login.
- Users cannot gain access to pages outside their role by refreshing or reopening a direct URL.

### TC-21 Basic Error Handling

Roles: Any

Steps:

1. Try submitting empty required fields in ticket forms or editable forms.
2. Try invalid data where applicable.
3. Temporarily navigate to a page without required project query parameters.

Expected result:

- App shows helpful validation or redirects safely.
- No blank page appears.
- Console errors should be reported if they block user actions.

## Regression Checklist

Before closing the QA pass, confirm:

- At least one account per role has been tested.
- At least one project-specific internal user has been tested.
- At least one admin-only action has been tested.
- At least one participant-facing flow has been tested.
- At least one ticket was created and replied to.
- At least one audit log entry was verified.
- Permission restrictions were tested with non-admin users.
- Any blocker/high issues are documented with screenshots.

## Feedback Format

Please report each issue with the fields below.

Suggested title format:

`[Severity] [Role] Short issue summary`

Required details:

- Account used
- Role
- Project
- Page URL
- Steps to reproduce
- Expected result
- Actual result
- Screenshot or screen recording if possible
- Severity: Blocker, High, Medium, Low

Example:

```text
Title: [High] [Client] Client can open Update Status page directly
Account used: r8mt4.client-abc@inbox.testmail.app
Role: Client
Project: Project ABC
Page URL: https://tanastudio.github.io/ProjectTracker/form.html?project=...
Steps to reproduce:
1. Login as Client ABC.
2. Paste the Update Status URL directly.
Expected result: Client should be redirected or blocked.
Actual result: Update Status page opens.
Severity: High
Attachment: screenshot.png
```

## Out Of Scope For This Pass

- Load/performance testing
- Penetration testing
- Browser automation coverage
- Production data migration validation

## Notes For Testers

- If a test requires changing data, use only dummy records.
- If you are unsure whether an action is destructive, skip it and report the question.
- If the app appears stale after a recent fix, perform a hard refresh.
- If a page fails to load, include a screenshot of the browser console if possible.
