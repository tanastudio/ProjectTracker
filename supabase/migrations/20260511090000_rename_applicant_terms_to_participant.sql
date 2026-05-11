-- Rename legacy applicant terminology to participant for deployed databases.

DROP VIEW IF EXISTS public.project_overall_summary;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles
SET role = 'participant'
WHERE role = 'candi' || 'date';

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin','internal','client','participant','viewer'));

DO $$
DECLARE
    legacy_prefix text := 'candi' || 'date';
    legacy_record_column text := legacy_prefix || '_record_id';
    legacy_record_constraint text := 'profiles_' || legacy_record_column || '_fkey';
    legacy_name_column text := legacy_prefix || '_name';
    legacy_status_column text := 'show_in_' || legacy_prefix || '_status';
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = legacy_record_column
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'participant_record_id'
    ) THEN
        EXECUTE format('ALTER TABLE public.profiles RENAME COLUMN %I TO participant_record_id', legacy_record_column);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND constraint_name = legacy_record_constraint
    ) THEN
        EXECUTE format(
            'ALTER TABLE public.profiles RENAME CONSTRAINT %I TO profiles_participant_record_id_fkey',
            legacy_record_constraint
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requests'
          AND column_name = legacy_name_column
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requests'
          AND column_name = 'participant_name'
    ) THEN
        EXECUTE format('ALTER TABLE public.requests RENAME COLUMN %I TO participant_name', legacy_name_column);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fields'
          AND column_name = legacy_status_column
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fields'
          AND column_name = 'show_in_participant_status'
    ) THEN
        EXECUTE format('ALTER TABLE public.fields RENAME COLUMN %I TO show_in_participant_status', legacy_status_column);
    END IF;
END $$;

CREATE OR REPLACE VIEW public.project_overall_summary
WITH (security_invoker = true) AS
WITH overall AS (
    SELECT
        rv.record_id,
        COALESCE(rv.value_select, rv.value_text) AS status
    FROM public.record_values rv
    JOIN public.fields f ON f.id = rv.field_id
    WHERE f.field_role = 'overall_status'
)
SELECT
    r.project_id,
    COUNT(r.id)                                                                    AS total_participants,
    COUNT(r.id) FILTER (WHERE o.status = 'Completed')                             AS n_completed,
    COUNT(r.id) FILTER (WHERE o.status = 'In Progress')                           AS n_in_progress,
    COUNT(r.id) FILTER (WHERE o.status = 'Issue')                                 AS n_issue,
    COUNT(r.id) FILTER (WHERE o.status IS NULL
                           OR o.status NOT IN ('Completed','In Progress','Issue')) AS n_not_started
FROM public.records r
LEFT JOIN overall o ON o.record_id = r.id
WHERE r.active IS NOT FALSE
GROUP BY r.project_id;

CREATE OR REPLACE FUNCTION public.generate_participant_code(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prefix text;
    v_seq    int;
BEGIN
    SELECT code_prefix INTO v_prefix
    FROM public.projects
    WHERE id = p_project_id
    FOR UPDATE;

    IF v_prefix IS NULL OR trim(v_prefix) = '' THEN
        RETURN NULL;
    END IF;

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
                  (
                      public.current_profile_role() = 'internal'
                      AND (
                          public.is_project_creator(r.project_id)
                          OR public.is_project_member(r.project_id)
                      )
                  )
                  OR public.is_client_assigned_record(p_record_id)
              )
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
              OR public.owns_record(q.record_id)
              OR (
                  public.current_profile_role() = 'internal'
                  AND (
                      public.is_project_creator(q.project_id)
                      OR public.is_project_member(q.project_id)
                  )
              )
              OR public.is_client_assigned_record(q.record_id)
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.audit_project_id(p_table_name text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id uuid;
BEGIN
    IF p_row IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_table_name = 'projects' AND p_row ? 'id' THEN
        RETURN NULLIF(p_row ->> 'id', '')::uuid;
    END IF;

    IF p_row ? 'project_id' THEN
        RETURN NULLIF(p_row ->> 'project_id', '')::uuid;
    END IF;

    IF p_table_name = 'record_values' AND p_row ? 'record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'ticket_replies' AND p_row ? 'ticket_id' THEN
        SELECT q.project_id INTO v_project_id
        FROM public.requests q
        WHERE q.id = NULLIF(p_row ->> 'ticket_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'ticket_read_states' AND p_row ? 'ticket_id' THEN
        SELECT q.project_id INTO v_project_id
        FROM public.requests q
        WHERE q.id = NULLIF(p_row ->> 'ticket_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'client_record_assignments' AND p_row ? 'record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'profiles' AND p_row ? 'participant_record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'participant_record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

DO $$
DECLARE
    legacy_prefix text := 'candi' || 'date';
BEGIN
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(uuid)', 'generate_' || legacy_prefix || '_code');
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I()', 'current_' || legacy_prefix || '_record_id');
END $$;
