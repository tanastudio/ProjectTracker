-- ============================================================
-- Adjust access model: client project members can view all records in project
-- ============================================================

-- Keep role model aligned with user expectation:
-- admin: all
-- internal/client: all records + tickets in projects where they are member/creator
-- candidate: own record only

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
              AND public.current_profile_role() IN ('internal', 'client')
              AND (
                  public.is_project_creator(r.project_id)
                  OR public.is_project_member(r.project_id)
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
                  public.current_profile_role() IN ('internal', 'client')
                  AND (
                      public.is_project_creator(q.project_id)
                      OR public.is_project_member(q.project_id)
                  )
              )
          )
    );
$$;

DROP POLICY IF EXISTS requests_insert ON public.requests;

CREATE POLICY requests_insert ON public.requests
FOR INSERT TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND (
        public.is_admin()
        OR public.owns_record(record_id)
        OR (
            public.current_profile_role() IN ('internal', 'client')
            AND (
                public.is_project_creator(project_id)
                OR public.is_project_member(project_id)
            )
        )
    )
);