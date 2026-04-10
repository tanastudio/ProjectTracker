-- ============================================================
-- Restore persistent "Assessments" field
-- Ensures existing projects have this field if missing.
-- ============================================================

DO $$
DECLARE
    v_options_type text;
BEGIN
    SELECT a.atttypid::regtype::text
      INTO v_options_type
      FROM pg_attribute a
      JOIN pg_class c
        ON c.oid = a.attrelid
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'fields'
       AND a.attname = 'options'
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF v_options_type = 'jsonb' THEN
        INSERT INTO public.fields (
            project_id,
            key,
            label,
            type,
            options,
            sort_order,
            field_role,
            is_active,
            show_in_dashboard,
            visible
        )
        SELECT
            p.id,
            'assessments',
            'Assessments',
            'select',
            to_jsonb(ARRAY['Not Started','In Progress','Completed','Issue']::text[]),
            20,
            'step',
            true,
            true,
            true
        FROM public.projects p
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.fields f
            WHERE f.project_id = p.id
              AND f.key = 'assessments'
        );
    ELSE
        INSERT INTO public.fields (
            project_id,
            key,
            label,
            type,
            options,
            sort_order,
            field_role,
            is_active,
            show_in_dashboard,
            visible
        )
        SELECT
            p.id,
            'assessments',
            'Assessments',
            'select',
            ARRAY['Not Started','In Progress','Completed','Issue'],
            20,
            'step',
            true,
            true,
            true
        FROM public.projects p
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.fields f
            WHERE f.project_id = p.id
              AND f.key = 'assessments'
        );
    END IF;
END $$;
