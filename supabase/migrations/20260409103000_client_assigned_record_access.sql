-- ============================================================
-- Client access hardening: assigned-only record visibility
-- ============================================================

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

CREATE OR REPLACE FUNCTION public.current_candidate_record_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.candidate_record_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
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
       AND public.current_candidate_record_id() = p_record_id;
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

-- 1) Explicit assignment map: which client can access which candidate record
CREATE TABLE IF NOT EXISTS public.client_record_assignments (
    client_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    record_id      uuid        NOT NULL REFERENCES public.records(id) ON DELETE CASCADE,
    assigned_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_user_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_client_record_assignments_record_id
    ON public.client_record_assignments(record_id);

ALTER TABLE public.client_record_assignments ENABLE ROW LEVEL SECURITY;

-- 2) Helper: only true for client role with explicit assignment
CREATE OR REPLACE FUNCTION public.is_client_assigned_record(p_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.current_profile_role() = 'client'
        AND EXISTS (
            SELECT 1
            FROM public.client_record_assignments cra
            WHERE cra.client_user_id = auth.uid()
              AND cra.record_id = p_record_id
        );
$$;

-- 3) Narrow record access model:
--    - admin: all
--    - internal: project member/creator only
--    - candidate: own record only
--    - client: assigned records only
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

-- 4) Keep ticket visibility aligned with record visibility model
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

-- 5) Tighten request insert scope for client/internal (admin unchanged)
DROP POLICY IF EXISTS requests_insert ON public.requests;

CREATE POLICY requests_insert ON public.requests
FOR INSERT TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND (
        public.is_admin()
        OR (
            public.current_profile_role() = 'internal'
            AND (
                public.is_project_creator(project_id)
                OR public.is_project_member(project_id)
            )
        )
        OR public.owns_record(record_id)
        OR public.is_client_assigned_record(record_id)
    )
);

-- 6) RLS for assignment table
DROP POLICY IF EXISTS client_record_assignments_select ON public.client_record_assignments;
DROP POLICY IF EXISTS client_record_assignments_insert ON public.client_record_assignments;
DROP POLICY IF EXISTS client_record_assignments_delete ON public.client_record_assignments;

CREATE POLICY client_record_assignments_select ON public.client_record_assignments
FOR SELECT TO authenticated
USING (
    public.is_admin()
    OR public.is_internal()
    OR client_user_id = auth.uid()
);

CREATE POLICY client_record_assignments_insert ON public.client_record_assignments
FOR INSERT TO authenticated
WITH CHECK (
    (public.is_admin() OR public.is_internal())
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = client_user_id
          AND p.role = 'client'
    )
    AND public.can_edit_record(record_id)
);

CREATE POLICY client_record_assignments_delete ON public.client_record_assignments
FOR DELETE TO authenticated
USING (
    (public.is_admin() OR public.is_internal())
    AND public.can_edit_record(record_id)
);
