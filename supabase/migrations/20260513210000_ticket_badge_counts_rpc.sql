-- Aggregate ticket badge counts server-side so browser navigation badges do not
-- need to fetch every ticket, reply, and read-state row for each project.

CREATE OR REPLACE FUNCTION public.get_ticket_counts_for_projects(p_project_ids uuid[])
RETURNS TABLE (
    project_id uuid,
    unread_count bigint,
    open_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH requested_projects AS (
        SELECT DISTINCT unnest(COALESCE(p_project_ids, ARRAY[]::uuid[])) AS project_id
    ),
    visible_open_tickets AS (
        SELECT
            q.id,
            q.project_id,
            GREATEST(
                CASE WHEN q.created_by IS DISTINCT FROM auth.uid() THEN q.created_at ELSE NULL END,
                CASE WHEN q.replied_by IS DISTINCT FROM auth.uid() THEN q.replied_at ELSE NULL END,
                MAX(tr.created_at) FILTER (WHERE tr.author_id IS DISTINCT FROM auth.uid())
            ) AS last_external_activity_at
        FROM requested_projects rp
        JOIN public.requests q
          ON q.project_id = rp.project_id
        LEFT JOIN public.ticket_replies tr
          ON tr.ticket_id = q.id
        WHERE auth.uid() IS NOT NULL
          AND lower(COALESCE(q.status, 'open')) = 'open'
          AND public.can_access_request(q.id)
        GROUP BY q.id, q.project_id, q.created_by, q.created_at, q.replied_by, q.replied_at
    )
    SELECT
        rp.project_id,
        COUNT(vot.id) FILTER (
            WHERE COALESCE(vot.last_external_activity_at, 'epoch'::timestamptz)
                > COALESCE(trs.last_read_at, 'epoch'::timestamptz)
        ) AS unread_count,
        COUNT(vot.id) AS open_count
    FROM requested_projects rp
    LEFT JOIN visible_open_tickets vot
      ON vot.project_id = rp.project_id
    LEFT JOIN public.ticket_read_states trs
      ON trs.ticket_id = vot.id
     AND trs.user_id = auth.uid()
    GROUP BY rp.project_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_ticket_counts_for_projects(uuid[]) TO authenticated;
