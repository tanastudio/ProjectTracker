DROP FUNCTION IF EXISTS public.get_project_members_for_settings(uuid);

CREATE OR REPLACE FUNCTION public.get_project_members_for_settings(p_project_id uuid)
RETURNS TABLE (
    user_id uuid,
    member_role text,
    display_name text,
    email text,
    profile_role text,
    participant_record_id uuid,
    participant_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pm.user_id,
        pm.role AS member_role,
        p.display_name,
        p.email,
        p.role AS profile_role,
        p.participant_record_id,
        CASE
            WHEN p.role = 'participant' AND p.participant_record_id IS NOT NULL
                THEN COALESCE(r.active, true)
            ELSE NULL
        END AS participant_active
    FROM public.project_members pm
    LEFT JOIN public.profiles p
      ON p.id = pm.user_id
    LEFT JOIN public.records r
      ON r.id = p.participant_record_id
     AND r.project_id = p_project_id
    WHERE pm.project_id = p_project_id
      AND (
          public.is_admin()
          OR public.can_edit_project(p_project_id)
      )
    ORDER BY p.role, p.display_name, p.email, pm.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_members_for_settings(uuid) TO authenticated;
