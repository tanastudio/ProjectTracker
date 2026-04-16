-- ============================================================
-- Persistent ticket read-state per user
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ticket_read_states (
    user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticket_id    uuid        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
    last_read_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_read_states_ticket_id
    ON public.ticket_read_states(ticket_id);

ALTER TABLE public.ticket_read_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_read_states_select ON public.ticket_read_states;
DROP POLICY IF EXISTS ticket_read_states_insert ON public.ticket_read_states;
DROP POLICY IF EXISTS ticket_read_states_update ON public.ticket_read_states;
DROP POLICY IF EXISTS ticket_read_states_delete ON public.ticket_read_states;

CREATE POLICY ticket_read_states_select ON public.ticket_read_states
FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    AND public.can_access_request(ticket_id)
);

CREATE POLICY ticket_read_states_insert ON public.ticket_read_states
FOR INSERT TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND public.can_access_request(ticket_id)
);

CREATE POLICY ticket_read_states_update ON public.ticket_read_states
FOR UPDATE TO authenticated
USING (
    user_id = auth.uid()
    AND public.can_access_request(ticket_id)
)
WITH CHECK (
    user_id = auth.uid()
    AND public.can_access_request(ticket_id)
);

CREATE POLICY ticket_read_states_delete ON public.ticket_read_states
FOR DELETE TO authenticated
USING (
    user_id = auth.uid()
    AND public.can_access_request(ticket_id)
);

CREATE OR REPLACE FUNCTION public.mark_project_tickets_seen(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_marked integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_project(p_project_id) THEN
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

GRANT EXECUTE ON FUNCTION public.mark_project_tickets_seen(uuid) TO authenticated;
