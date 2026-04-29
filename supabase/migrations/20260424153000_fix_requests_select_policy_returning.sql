-- Fix request inserts with RETURNING under RLS.
-- The previous SELECT policy delegated to can_access_request(id), which
-- re-queried public.requests and could reject freshly inserted rows during
-- INSERT ... RETURNING, even though the insert itself was allowed.

DROP POLICY IF EXISTS requests_select ON public.requests;

CREATE POLICY requests_select ON public.requests
FOR SELECT TO authenticated
USING (
    public.is_admin()
    OR public.owns_record(record_id)
    OR (
        public.current_profile_role() IN ('internal', 'client')
        AND (
            public.is_project_creator(project_id)
            OR public.is_project_member(project_id)
        )
    )
);
