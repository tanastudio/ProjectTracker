-- ============================================================
-- Local development seed data
-- Applied automatically by: npx supabase db reset
-- Credentials for local testing:
--   Admin  →  admin@example.com  /  Admin1234!
-- ============================================================

-- ── Auth users ───────────────────────────────────────────────
INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    email_change_confirm_status, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_super_admin, is_sso_user, is_anonymous
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'admin@example.com',
    crypt('Admin1234!', gen_salt('bf')),
    now(),
    '', '',
    '', '', '',
    0, '',
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Local Admin","role":"admin"}',
    now(), now(),
    false, false, false
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'admin@example.com',
    'email',
    '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@example.com"}',
    now(), now(), now()
) ON CONFLICT (id) DO NOTHING;

-- ── Admin profile ─────────────────────────────────────────────
INSERT INTO public.profiles (id, display_name, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'Local Admin', 'admin@example.com', 'admin')
ON CONFLICT (id) DO NOTHING;

-- ── Sample project ────────────────────────────────────────────
INSERT INTO public.projects (id, name, description, status, code_prefix, created_by)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'Sample Project',
    'A local development sample project.',
    'active',
    'SAMP',
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (id) DO NOTHING;

-- ── Project membership ────────────────────────────────────────
INSERT INTO public.project_members (user_id, project_id, role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'editor'
) ON CONFLICT (user_id, project_id) DO NOTHING;

-- ── Fields (matching frontend column names: key, label, type) ─
INSERT INTO public.fields (id, project_id, key, label, type, sort_order, field_role, is_active, show_in_dashboard, visible, options)
VALUES
    -- Step field (select)
    ('20000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'document_check', 'Document Check', 'select', 10,
     'step', true, true, true,
     ARRAY['Not Started','In Progress','Completed','Issue']),
    -- Assessments field (select)
    ('20000000-0000-0000-0000-000000000006',
     '10000000-0000-0000-0000-000000000001',
     'assessments', 'Assessments', 'select', 20,
     'step', true, true, true,
     ARRAY['Not Started','In Progress','Completed','Issue']),
    -- Email field (text, fixed)
    ('20000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     'email', 'Email', 'text', 15,
     'email', true, false, true,
     NULL),
    -- Issue field (text, fixed)
    ('20000000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001',
     'issue', 'Issue', 'text', 100,
     'issue', true, false, true,
     NULL),
    -- Decision field (text, fixed)
    ('20000000-0000-0000-0000-000000000004',
     '10000000-0000-0000-0000-000000000001',
     'decision', 'Decision', 'text', 110,
     'decision', true, false, true,
     NULL),
    -- Overall status field (select, fixed)
    ('20000000-0000-0000-0000-000000000005',
     '10000000-0000-0000-0000-000000000001',
     'overall_status', 'Overall Status', 'select', 999,
     'overall_status', true, true, true,
     ARRAY['Not Started','In Progress','Completed','Issue'])
ON CONFLICT (id) DO NOTHING;

-- ── Sample participant record ───────────────────────────────────
INSERT INTO public.records (id, project_id, code, title, active, updated_by)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'SAMP-0001',
    'Sample Participant',
    true,
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (id) DO NOTHING;

-- ── Sample record values ──────────────────────────────────────
INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
VALUES
    -- document_check step → In Progress
    ('30000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000001',
     NULL, 'In Progress'),
    ('30000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000006',
     NULL, 'In Progress'),
    -- email
    ('30000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000002',
     'localtest.cand001@inbox.testmail.app', NULL),
    -- overall_status → In Progress
    ('30000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000005',
     NULL, 'In Progress')
ON CONFLICT (record_id, field_id)
DO UPDATE SET
    value_text   = EXCLUDED.value_text,
    value_select = EXCLUDED.value_select;

-- Ensure overall_status is recomputed from current select fields.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'refresh_overall_status_for_project'
    ) THEN
        PERFORM public.refresh_overall_status_for_project(p.id)
        FROM public.projects p;
    END IF;
END $$;

-- ── Additional participants (varied statuses for dashboard testing) ─
INSERT INTO public.records (id, project_id, code, title, active, updated_by) VALUES
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'SAMP-0002', 'Alice Johnson',      true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'SAMP-0003', 'Bob Smith',          true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'SAMP-0004', 'Carol White',        true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'SAMP-0005', 'David Brown',        true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'SAMP-0006', 'Emma Davis',         true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'SAMP-0007', 'Frank Miller',       true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'SAMP-0008', 'Grace Wilson',       true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'SAMP-0009', 'Henry Taylor',       true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'SAMP-0010', 'Isabella Anderson',  true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'SAMP-0011', 'James Martinez',     true, '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'SAMP-0012', 'Karen Thompson',     true, '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ── Record values for additional participants ───────────────────
-- Field IDs:
--   20000000-…-0001 = document_check (select/step)
--   20000000-…-0002 = email           (text)
--   20000000-…-0003 = issue            (text)
--   20000000-…-0004 = decision         (text)
--   20000000-…-0005 = overall_status   (select)
INSERT INTO public.record_values (record_id, field_id, value_text, value_select) VALUES
    -- SAMP-0002  Alice Johnson — Completed
    ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001', NULL, 'Completed'),
    ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002', 'localtest.cand002@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005', NULL, 'Completed'),

    -- SAMP-0003  Bob Smith — Completed
    ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001', NULL, 'Completed'),
    ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002', 'localtest.cand003@inbox.testmail.app',     NULL),
    ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005', NULL, 'Completed'),

    -- SAMP-0004  Carol White — Completed
    ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001', NULL, 'Completed'),
    ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002', 'localtest.cand004@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005', NULL, 'Completed'),

    -- SAMP-0005  David Brown — In Progress
    ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001', NULL, 'In Progress'),
    ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002', 'localtest.cand005@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005', NULL, 'In Progress'),

    -- SAMP-0006  Emma Davis — In Progress
    ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001', NULL, 'Not Started'),
    ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002', 'localtest.cand006@inbox.testmail.app',    NULL),
    ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000005', NULL, 'In Progress'),

    -- SAMP-0007  Frank Miller — In Progress
    ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001', NULL, 'In Progress'),
    ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000002', 'localtest.cand007@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000005', NULL, 'In Progress'),

    -- SAMP-0008  Grace Wilson — In Progress
    ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001', NULL, 'In Progress'),
    ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000002', 'localtest.cand008@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000005', NULL, 'In Progress'),

    -- SAMP-0009  Henry Taylor — Issue
    ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001', NULL, 'Issue'),
    ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002', 'localtest.cand009@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000003', 'Missing transcript',  NULL),
    ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000004', 'Pending review',      NULL),
    ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000005', NULL, 'Issue'),

    -- SAMP-0010  Isabella Anderson — Issue
    ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001', NULL, 'Issue'),
    ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000002', 'localtest.cand010@inbox.testmail.app',NULL),
    ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000003', 'Wrong document submitted', NULL),
    ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000004', 'Request resubmission', NULL),
    ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000005', NULL, 'Issue'),

    -- SAMP-0011  James Martinez — Not Started
    ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001', NULL, 'Not Started'),
    ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000002', 'localtest.cand011@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000005', NULL, 'Not Started'),

    -- SAMP-0012  Karen Thompson — Not Started
    ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001', NULL, 'Not Started'),
    ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000002', 'localtest.cand012@inbox.testmail.app',   NULL),
    ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000005', NULL, 'Not Started')

ON CONFLICT (record_id, field_id)
DO UPDATE SET
    value_text   = EXCLUDED.value_text,
    value_select = EXCLUDED.value_select;
