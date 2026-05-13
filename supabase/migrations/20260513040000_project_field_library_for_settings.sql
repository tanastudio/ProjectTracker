CREATE OR REPLACE FUNCTION public.get_project_field_library_for_settings(p_project_id uuid)
RETURNS TABLE (
    key text,
    label text,
    type text,
    field_role text,
    options jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (f.key)
        f.key,
        f.label,
        f.type,
        CASE WHEN f.type = 'select' AND f.field_role = 'booking' THEN 'booking' ELSE 'step' END AS field_role,
        to_jsonb(f.options) AS options
    FROM public.fields f
    WHERE f.is_active IS NOT FALSE
      AND COALESCE(f.field_role, 'step') IN ('step', 'booking')
      AND (
          public.is_admin()
          OR public.can_edit_project(p_project_id)
      )
    ORDER BY f.key, (f.project_id = p_project_id), f.label;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_field_library_for_settings(uuid) TO authenticated;

DROP POLICY IF EXISTS fields_insert_project_editors ON public.fields;
DROP POLICY IF EXISTS fields_update_project_editors ON public.fields;
DROP POLICY IF EXISTS fields_delete_project_editors ON public.fields;

CREATE POLICY fields_insert_project_editors ON public.fields
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY fields_update_project_editors ON public.fields
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY fields_delete_project_editors ON public.fields
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));
