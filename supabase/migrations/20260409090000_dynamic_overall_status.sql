-- Dynamic DB-side overall_status calculation.
-- Includes new select fields created from Admin automatically.

CREATE OR REPLACE FUNCTION public.compute_overall_status_for_record(p_record_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id      uuid;
    v_total_steps     integer := 0;
    v_issue_count     integer := 0;
    v_progress_count  integer := 0;
    v_completed_count integer := 0;
    v_notstart_count  integer := 0;
BEGIN
    SELECT r.project_id
      INTO v_project_id
      FROM public.records r
     WHERE r.id = p_record_id;

    IF v_project_id IS NULL THEN
        RETURN 'Not Started';
    END IF;

    WITH step_fields AS (
        SELECT
            f.id,
            CASE
                WHEN jsonb_typeof(COALESCE(to_jsonb(f.options), '[]'::jsonb)) = 'array'
                     AND jsonb_array_length(COALESCE(to_jsonb(f.options), '[]'::jsonb)) >= 1
                    THEN COALESCE(to_jsonb(f.options), '[]'::jsonb)->>0
                ELSE 'Not Started'
            END AS default_status,
            COALESCE(to_jsonb(f.options), '[]'::jsonb) AS options_json
        FROM public.fields f
        WHERE f.project_id = v_project_id
          AND f.type = 'select'
          AND COALESCE(f.field_role, '') <> 'overall_status'
          AND COALESCE(f.is_active, true) = true
    ),
    normalized AS (
        SELECT
            CASE
                WHEN jsonb_typeof(s.options_json) = 'array'
                     AND jsonb_array_length(s.options_json) >= 1
                     AND EXISTS (
                         SELECT 1
                         FROM jsonb_array_elements_text(s.options_json) AS option_value(value)
                         WHERE option_value.value = COALESCE(rv.value_select, rv.value_text)
                     )
                    THEN COALESCE(rv.value_select, rv.value_text)
                ELSE s.default_status
            END AS raw_status
        FROM step_fields s
        LEFT JOIN public.record_values rv
               ON rv.record_id = p_record_id
              AND rv.field_id = s.id
    ),
    canonical AS (
        SELECT
            CASE
                WHEN raw_status = 'Issue' THEN 'Issue'
                WHEN raw_status = 'Completed' THEN 'Completed'
                WHEN raw_status = 'In Progress' THEN 'In Progress'
                ELSE 'Not Started'
            END AS status
        FROM normalized
    )
    SELECT
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE status = 'Issue')::int,
        COUNT(*) FILTER (WHERE status = 'In Progress')::int,
        COUNT(*) FILTER (WHERE status = 'Completed')::int,
        COUNT(*) FILTER (WHERE status = 'Not Started')::int
    INTO
        v_total_steps,
        v_issue_count,
        v_progress_count,
        v_completed_count,
        v_notstart_count
    FROM canonical;

    IF v_total_steps = 0 THEN
        RETURN 'Not Started';
    END IF;

    IF v_issue_count > 0 THEN
        RETURN 'Issue';
    END IF;

    IF v_completed_count = v_total_steps THEN
        RETURN 'Completed';
    END IF;

    IF v_progress_count > 0 THEN
        RETURN 'In Progress';
    END IF;

    IF v_completed_count > 0 AND v_notstart_count > 0 THEN
        RETURN 'In Progress';
    END IF;

    RETURN 'Not Started';
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_overall_status_for_record(p_record_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id       uuid;
    v_overall_field_id uuid;
    v_status           text;
    v_has_updated_at   boolean;
BEGIN
    SELECT r.project_id
      INTO v_project_id
      FROM public.records r
     WHERE r.id = p_record_id;

    IF v_project_id IS NULL THEN
        RETURN;
    END IF;

    SELECT f.id
      INTO v_overall_field_id
      FROM public.fields f
     WHERE f.project_id = v_project_id
       AND f.field_role = 'overall_status'
     ORDER BY f.sort_order, f.id
     LIMIT 1;

    IF v_overall_field_id IS NULL THEN
        RETURN;
    END IF;

    v_status := public.compute_overall_status_for_record(p_record_id);

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'record_values'
          AND column_name = 'updated_at'
    )
    INTO v_has_updated_at;

    IF v_has_updated_at THEN
        INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
        VALUES (p_record_id, v_overall_field_id, NULL, v_status)
        ON CONFLICT (record_id, field_id)
        DO UPDATE SET
            value_text = NULL,
            value_select = EXCLUDED.value_select,
            updated_at = now();
    ELSE
        INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
        VALUES (p_record_id, v_overall_field_id, NULL, v_status)
        ON CONFLICT (record_id, field_id)
        DO UPDATE SET
            value_text = NULL,
            value_select = EXCLUDED.value_select;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_overall_status_for_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT r.id
        FROM public.records r
        WHERE r.project_id = p_project_id
    LOOP
        PERFORM public.refresh_overall_status_for_record(rec.id);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_overall_from_record_values()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_record_id uuid;
BEGIN
    -- Prevent recursion from our own upsert into overall_status row.
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    v_record_id := COALESCE(NEW.record_id, OLD.record_id);
    IF v_record_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM public.refresh_overall_status_for_record(v_record_id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_overall_from_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_project uuid;
    v_new_project uuid;
    v_old_relevant boolean := false;
    v_new_relevant boolean := false;
BEGIN
    v_old_project := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.project_id ELSE NULL END;
    v_new_project := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.project_id ELSE NULL END;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old_relevant := (
            OLD.type = 'select'
            OR COALESCE(OLD.field_role, '') = 'overall_status'
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_relevant := (
            NEW.type = 'select'
            OR COALESCE(NEW.field_role, '') = 'overall_status'
        );
    END IF;

    IF v_old_relevant AND v_old_project IS NOT NULL THEN
        PERFORM public.refresh_overall_status_for_project(v_old_project);
    END IF;

    IF v_new_relevant
       AND v_new_project IS NOT NULL
       AND (v_old_project IS DISTINCT FROM v_new_project OR NOT v_old_relevant) THEN
        PERFORM public.refresh_overall_status_for_project(v_new_project);
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_overall_from_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.refresh_overall_status_for_record(NEW.id);
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
            PERFORM public.refresh_overall_status_for_project(OLD.project_id);
            PERFORM public.refresh_overall_status_for_record(NEW.id);
        ELSE
            PERFORM public.refresh_overall_status_for_record(NEW.id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_overall_from_record_values ON public.record_values;
CREATE TRIGGER trg_refresh_overall_from_record_values
AFTER INSERT OR UPDATE OR DELETE ON public.record_values
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_overall_from_record_values();

DROP TRIGGER IF EXISTS trg_refresh_overall_from_fields ON public.fields;
CREATE TRIGGER trg_refresh_overall_from_fields
AFTER INSERT OR UPDATE OR DELETE ON public.fields
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_overall_from_fields();

DROP TRIGGER IF EXISTS trg_refresh_overall_from_records ON public.records;
CREATE TRIGGER trg_refresh_overall_from_records
AFTER INSERT OR UPDATE OF project_id, active ON public.records
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_overall_from_records();

-- Backfill current data immediately.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN SELECT id FROM public.projects LOOP
        PERFORM public.refresh_overall_status_for_project(p.id);
    END LOOP;
END $$;
