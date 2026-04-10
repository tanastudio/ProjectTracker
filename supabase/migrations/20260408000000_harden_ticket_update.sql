-- ============================================================
-- Harden ticket updates: RPC with column-level role checks
-- + narrow requests_update policy to admin-only direct writes
-- ============================================================

-- ── 1. Narrow direct UPDATE policy ───────────────────────────
-- Removes project_member direct UPDATE permission.
-- All browser updates must go through update_ticket() RPC.
-- Admins retain direct access for dashboard/tooling use.
DROP POLICY IF EXISTS requests_update ON public.requests;

CREATE POLICY requests_update ON public.requests
FOR UPDATE TO authenticated
USING  (public.is_admin())
WITH CHECK (public.is_admin());

-- ── 2. Column-level ticket update RPC ─────────────────────────
-- Parameters:
--   p_ticket_id    — ticket to update (required)
--   p_status       — new status (admin/internal only)
--   p_priority     — new priority (admin/internal/client)
--   p_owner_user_id — new owner, can be NULL to unassign (admin/internal only)
--   p_set_owner    — must be TRUE to apply p_owner_user_id; distinguishes
--                    "don't touch owner" from "set owner to NULL"
CREATE OR REPLACE FUNCTION public.update_ticket(
    p_ticket_id     uuid,
    p_status        text    DEFAULT NULL,
    p_priority      text    DEFAULT NULL,
    p_owner_user_id uuid    DEFAULT NULL,
    p_set_owner     boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text := public.current_profile_role();
BEGIN
    -- Verify caller can view this ticket (RLS-equivalent check)
    IF NOT public.can_access_request(p_ticket_id) THEN
        RAISE EXCEPTION 'Access denied: ticket not found or insufficient permission';
    END IF;

    -- Minimum role gate: candidate and viewer cannot update
    IF v_role NOT IN ('admin', 'internal', 'client') THEN
        RAISE EXCEPTION 'Permission denied: role % cannot update tickets', v_role;
    END IF;

    -- Column-level guards: status and owner are admin/internal only
    IF p_status IS NOT NULL AND v_role NOT IN ('admin', 'internal') THEN
        RAISE EXCEPTION 'Permission denied: only admin/internal can change ticket status';
    END IF;

    IF p_set_owner AND v_role NOT IN ('admin', 'internal') THEN
        RAISE EXCEPTION 'Permission denied: only admin/internal can change ticket owner';
    END IF;

    UPDATE public.requests
    SET
        status        = CASE
                            WHEN p_status IS NOT NULL AND v_role IN ('admin', 'internal')
                            THEN p_status
                            ELSE status
                        END,
        priority      = COALESCE(p_priority, priority),
        owner_user_id = CASE
                            WHEN p_set_owner AND v_role IN ('admin', 'internal')
                            THEN p_owner_user_id   -- NULL is valid (unassign)
                            ELSE owner_user_id
                        END,
        updated_at    = now()
    WHERE id = p_ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_ticket TO authenticated;
