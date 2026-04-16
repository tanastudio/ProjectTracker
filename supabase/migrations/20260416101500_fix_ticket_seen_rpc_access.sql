-- ============================================================
-- Fix mark_project_tickets_seen access check
-- Avoid dependency on can_access_project(), which may not exist
-- in upgraded databases.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_project_tickets_seen(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_marked integer := 0;
    v_can_access boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT
        public.is_admin()
        OR public.is_project_creator(p_project_id)
        OR public.is_project_member(p_project_id)
        OR EXISTS (
            SELECT 1
            FROM public.requests q
            WHERE q.project_id = p_project_id
              AND public.can_access_request(q.id)
        )
    INTO v_can_access;

    IF NOT v_can_access THEN
        RAISE EXCEPTION 'Access denied: project not found or insufficient permission';
    END IF;

    INSERT INTO public.ticket_read_states (user_id, ticket_id, last_read_at, updated_at)
    SELECT auth.uid(), q.id, now(), now()
    FROM public.requests q
    WHERE q.project_id = p_project_id
      AND public.can_access_request(q.id)
    ON CONFLICT (user_id, ticket_id)
    DO UPDATE
    SET last_read_at = EXCLUDED.last_read_at,
        updated_at   = EXCLUDED.updated_at;

    GET DIAGNOSTICS v_marked = ROW_COUNT;
    RETURN v_marked;
END;
$$;
