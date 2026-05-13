CREATE OR REPLACE FUNCTION public.get_project_members_for_settings(p_project_id uuid)
RETURNS TABLE (
    user_id uuid,
    member_role text,
    display_name text,
    email text,
    profile_role text
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
        p.role AS profile_role
    FROM public.project_members pm
    LEFT JOIN public.profiles p
      ON p.id = pm.user_id
    WHERE pm.project_id = p_project_id
      AND (
          public.is_admin()
          OR public.can_edit_project(p_project_id)
      )
    ORDER BY p.role, p.display_name, p.email, pm.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_members_for_settings(uuid) TO authenticated;

DROP POLICY IF EXISTS project_members_insert ON public.project_members;
DROP POLICY IF EXISTS project_members_update ON public.project_members;
DROP POLICY IF EXISTS project_members_delete ON public.project_members;

CREATE POLICY project_members_insert ON public.project_members
FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY project_members_update ON public.project_members
FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY project_members_delete ON public.project_members
FOR DELETE TO authenticated
USING (public.is_admin());
