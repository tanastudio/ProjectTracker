-- ============================================================
-- Initial schema for Project Tracker V3
-- Run automatically by: npx supabase db reset
-- ============================================================

-- ── Profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id                  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name        text,
    email               text,
    role                text        NOT NULL DEFAULT 'viewer',
    participant_record_id uuid,                           -- FK added after records table
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_role_check CHECK (role IN ('admin','internal','client','participant','viewer'))
);

-- ── Projects ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    description text,
    status      text        NOT NULL DEFAULT 'active',  -- 'active','archived','draft'
    start_date  date,
    end_date    date,
    code_prefix text,
    related_invoice_number text,
    created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Project members ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
    user_id    uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'viewer',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id),
    CONSTRAINT project_members_role_check CHECK (role IN ('admin','editor','viewer'))
);

-- ── Fields ───────────────────────────────────────────────────
-- Column names match what the frontend uses: key, label, type (not name/field_type).
CREATE TABLE IF NOT EXISTS public.fields (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    key              text        NOT NULL,           -- machine name, e.g. "email"
    label            text        NOT NULL,           -- display name, e.g. "Email"
    type             text        NOT NULL DEFAULT 'text',  -- 'text' | 'select' | 'date'
    options          text[],                         -- allowed values for select fields
    sort_order       int         NOT NULL DEFAULT 0,
    field_role       text,                           -- 'email','issue','decision','overall_status','step'
    is_active        boolean     NOT NULL DEFAULT true,
    show_in_dashboard boolean    NOT NULL DEFAULT true,
    visible          boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, key)
);

-- ── Records (participants) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.records (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    code       text,
    title      text        NOT NULL,
    active     boolean     NOT NULL DEFAULT true,
    updated_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, code)                       -- prevents duplicate codes per project
);

-- Back-fill FK now that records exists
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_participant_record_id_fkey
    FOREIGN KEY (participant_record_id) REFERENCES public.records(id) ON DELETE SET NULL
    NOT VALID;

-- ── Record values ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.record_values (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id    uuid        NOT NULL REFERENCES public.records(id) ON DELETE CASCADE,
    field_id     uuid        NOT NULL REFERENCES public.fields(id)  ON DELETE CASCADE,
    value_text   text,       -- used for text/date field types
    value_select text,       -- used for select field types
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (record_id, field_id)
);

-- ── Requests (tickets) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.requests (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    record_id      uuid        REFERENCES public.records(id) ON DELETE SET NULL,
    code           text,                               -- denormalised copy from record
    participant_name text,
    subject        text        NOT NULL,
    message        text        NOT NULL,
    created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    status         text        NOT NULL DEFAULT 'open',
    priority       text        NOT NULL DEFAULT 'normal',
    owner_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    reply_message  text,
    replied_at     timestamptz,
    replied_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Ticket replies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_replies (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   uuid        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    author_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    author_role text,
    author_name text,
    message     text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Project overall summary view ──────────────────────────────
-- Used by projects.html to show per-project participant status counts.
-- Columns: project_id, total_participants, n_completed, n_in_progress, n_issue, n_not_started
CREATE OR REPLACE VIEW public.project_overall_summary
WITH (security_invoker = true) AS
WITH overall AS (
    -- Pull the overall_status value for each record (one row per record at most)
    SELECT
        rv.record_id,
        COALESCE(rv.value_select, rv.value_text) AS status
    FROM public.record_values rv
    JOIN public.fields f ON f.id = rv.field_id
    WHERE f.field_role = 'overall_status'
)
SELECT
    r.project_id,
    COUNT(r.id)                                                                               AS total_participants,
    COUNT(r.id) FILTER (WHERE o.status = 'Completed')                                        AS n_completed,
    COUNT(r.id) FILTER (WHERE o.status = 'In Progress')                                      AS n_in_progress,
    COUNT(r.id) FILTER (WHERE o.status = 'Issue')                                            AS n_issue,
    COUNT(r.id) FILTER (WHERE o.status IS NULL
                           OR o.status NOT IN ('Completed','In Progress','Issue'))            AS n_not_started
FROM public.records r
LEFT JOIN overall o ON o.record_id = r.id
WHERE r.active IS NOT FALSE
GROUP BY r.project_id;

-- ── Idempotent participant-code generator ──────────────────────
-- Uses a row-level lock on the project to prevent concurrent
-- requests from generating the same code.
CREATE OR REPLACE FUNCTION public.generate_participant_code(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prefix text;
    v_seq    int;
BEGIN
    -- Lock this project row for the duration of the transaction
    SELECT code_prefix INTO v_prefix
    FROM public.projects
    WHERE id = p_project_id
    FOR UPDATE;

    IF v_prefix IS NULL OR trim(v_prefix) = '' THEN
        RETURN NULL;
    END IF;

    -- Find the highest existing numeric suffix for this prefix
    SELECT COALESCE(
        MAX((regexp_replace(code, '^.*-', ''))::int),
        0
    ) + 1 INTO v_seq
    FROM public.records
    WHERE project_id = p_project_id
      AND starts_with(code, v_prefix || '-');

    RETURN v_prefix || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

-- ── Row-Level Security ────────────────────────────────────────
-- RLS is enabled on all tables.
-- DEVELOPMENT: the broad "authenticated" policies below let the
-- frontend work immediately after db reset.
-- PRODUCTION: replace with fine-grained policies before deploying.

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_values   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_replies  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()),
        'viewer'
    );
$$;

CREATE OR REPLACE FUNCTION public.current_participant_record_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.participant_record_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_profile_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_profile_role() = 'internal';
$$;

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = p_project_id
          AND p.created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.project_id = p_project_id
          AND pm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.is_project_creator(p_project_id)
        OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            WHERE pm.project_id = p_project_id
              AND pm.user_id = auth.uid()
              AND pm.role IN ('admin', 'editor')
        );
$$;

CREATE OR REPLACE FUNCTION public.owns_record(p_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_record_id IS NOT NULL
       AND public.current_participant_record_id() = p_record_id;
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.is_project_member(p_project_id)
        OR public.is_project_creator(p_project_id)
        OR EXISTS (
            SELECT 1
            FROM public.records r
            WHERE r.project_id = p_project_id
              AND r.id = public.current_participant_record_id()
        );
$$;

CREATE OR REPLACE FUNCTION public.can_access_record(p_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.owns_record(p_record_id)
        OR EXISTS (
            SELECT 1
            FROM public.records r
            WHERE r.id = p_record_id
              AND (
                  public.is_project_creator(r.project_id)
                  OR public.is_project_member(r.project_id)
              )
        );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_record(p_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.records r
            WHERE r.id = p_record_id
              AND public.can_edit_project(r.project_id)
        );
$$;

CREATE OR REPLACE FUNCTION public.can_access_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.requests q
        WHERE q.id = p_request_id
          AND (
              public.is_admin()
              OR public.is_project_creator(q.project_id)
              OR public.is_project_member(q.project_id)
              OR public.owns_record(q.record_id)
          )
    );
$$;

DROP POLICY IF EXISTS "dev_authenticated_all" ON public.profiles;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.projects;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.project_members;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.fields;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.records;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.record_values;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.requests;
DROP POLICY IF EXISTS "dev_authenticated_all" ON public.ticket_replies;

CREATE POLICY profiles_select ON public.profiles
FOR SELECT TO authenticated
USING (
    public.is_admin()
    OR (public.is_internal() AND role IN ('admin', 'internal', 'client'))
    OR id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM public.project_members me
        JOIN public.project_members other
          ON other.project_id = me.project_id
        WHERE me.user_id = auth.uid()
          AND other.user_id = profiles.id
    )
);

CREATE POLICY profiles_insert ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin()
    OR id = auth.uid()
);

CREATE POLICY profiles_update ON public.profiles
FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR id = auth.uid()
)
WITH CHECK (
    public.is_admin()
    OR id = auth.uid()
);

CREATE POLICY projects_select ON public.projects
FOR SELECT TO authenticated
USING (public.can_access_project(id));

CREATE POLICY projects_insert ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
    (public.is_admin() OR public.is_internal())
    AND created_by = auth.uid()
);

CREATE POLICY projects_update ON public.projects
FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR public.can_edit_project(id)
)
WITH CHECK (
    public.is_admin()
    OR public.can_edit_project(id)
);

CREATE POLICY projects_delete ON public.projects
FOR DELETE TO authenticated
USING (
    public.is_admin()
    OR public.is_project_creator(id)
);

CREATE POLICY project_members_select ON public.project_members
FOR SELECT TO authenticated
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.can_access_project(project_id)
);

CREATE POLICY project_members_insert ON public.project_members
FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.can_edit_project(project_id)
);

CREATE POLICY project_members_update ON public.project_members
FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.can_edit_project(project_id)
)
WITH CHECK (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.can_edit_project(project_id)
);

CREATE POLICY project_members_delete ON public.project_members
FOR DELETE TO authenticated
USING (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.can_edit_project(project_id)
);

CREATE POLICY fields_select ON public.fields
FOR SELECT TO authenticated
USING (public.can_access_project(project_id));

CREATE POLICY fields_insert ON public.fields
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY fields_update ON public.fields
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY fields_delete ON public.fields
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));

CREATE POLICY records_select ON public.records
FOR SELECT TO authenticated
USING (public.can_access_record(id));

CREATE POLICY records_insert ON public.records
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY records_update ON public.records
FOR UPDATE TO authenticated
USING (public.can_edit_record(id))
WITH CHECK (public.can_edit_record(id));

CREATE POLICY records_delete ON public.records
FOR DELETE TO authenticated
USING (public.can_edit_record(id));

CREATE POLICY record_values_select ON public.record_values
FOR SELECT TO authenticated
USING (public.can_access_record(record_id));

CREATE POLICY record_values_insert ON public.record_values
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_record(record_id));

CREATE POLICY record_values_update ON public.record_values
FOR UPDATE TO authenticated
USING (public.can_edit_record(record_id))
WITH CHECK (public.can_edit_record(record_id));

CREATE POLICY record_values_delete ON public.record_values
FOR DELETE TO authenticated
USING (public.can_edit_record(record_id));

CREATE POLICY requests_select ON public.requests
FOR SELECT TO authenticated
USING (public.can_access_request(id));

CREATE POLICY requests_insert ON public.requests
FOR INSERT TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND (
        public.is_admin()
        OR public.is_project_creator(project_id)
        OR public.is_project_member(project_id)
        OR public.owns_record(record_id)
    )
);

CREATE POLICY requests_update ON public.requests
FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.is_project_member(project_id)
)
WITH CHECK (
    public.is_admin()
    OR public.is_project_creator(project_id)
    OR public.is_project_member(project_id)
);

CREATE POLICY requests_delete ON public.requests
FOR DELETE TO authenticated
USING (public.is_admin());

CREATE POLICY ticket_replies_select ON public.ticket_replies
FOR SELECT TO authenticated
USING (public.can_access_request(ticket_id));

CREATE POLICY ticket_replies_insert ON public.ticket_replies
FOR INSERT TO authenticated
WITH CHECK (
    author_id = auth.uid()
    AND public.can_access_request(ticket_id)
);

CREATE POLICY ticket_replies_update ON public.ticket_replies
FOR UPDATE TO authenticated
USING (
    public.is_admin()
    OR author_id = auth.uid()
)
WITH CHECK (
    public.is_admin()
    OR author_id = auth.uid()
);

CREATE POLICY ticket_replies_delete ON public.ticket_replies
FOR DELETE TO authenticated
USING (
    public.is_admin()
    OR author_id = auth.uid()
);
