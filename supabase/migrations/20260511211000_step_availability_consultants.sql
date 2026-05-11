ALTER TABLE public.project_availability_slots
    ADD COLUMN IF NOT EXISTS field_id uuid REFERENCES public.fields(id) ON DELETE CASCADE;

ALTER TABLE public.project_availability_slots
    DROP CONSTRAINT IF EXISTS project_availability_slots_project_id_slot_date_start_time_key;

ALTER TABLE public.project_availability_slots
    DROP CONSTRAINT IF EXISTS project_availability_slots_project_field_date_start_key;

ALTER TABLE public.project_availability_slots
    ADD CONSTRAINT project_availability_slots_project_field_date_start_key
    UNIQUE (project_id, field_id, slot_date, start_time);

CREATE INDEX IF NOT EXISTS idx_project_availability_slots_project_field_date
    ON public.project_availability_slots(project_id, field_id, slot_date, start_time);

CREATE TABLE IF NOT EXISTS public.project_availability_step_settings (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    field_id    uuid        NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    is_enabled  boolean     NOT NULL DEFAULT false,
    created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_project_availability_step_settings_project
    ON public.project_availability_step_settings(project_id, is_enabled);

CREATE TABLE IF NOT EXISTS public.project_availability_consultants (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    field_id    uuid        NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    name        text        NOT NULL DEFAULT '',
    email       text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_availability_consultants_email_check CHECK (position('@' in email) > 1)
);

CREATE INDEX IF NOT EXISTS idx_project_availability_consultants_project_field
    ON public.project_availability_consultants(project_id, field_id, is_active, sort_order);

INSERT INTO public.project_availability_step_settings (project_id, field_id, is_enabled)
SELECT f.project_id, f.id, true
FROM public.fields f
WHERE COALESCE(f.type, '') = 'select'
  AND COALESCE(f.is_active, true) IS TRUE
  AND COALESCE(f.field_role, '') <> 'overall_status'
  AND (
    lower(COALESCE(f.key, '')) LIKE '%booking%'
    OR lower(COALESCE(f.key, '')) LIKE '%schedule%'
    OR lower(COALESCE(f.label, '')) LIKE '%booking%'
    OR lower(COALESCE(f.label, '')) LIKE '%schedule%'
  )
ON CONFLICT (project_id, field_id) DO NOTHING;

INSERT INTO public.project_availability_slots (
    project_id,
    field_id,
    slot_date,
    start_time,
    end_time,
    timezone,
    is_active,
    created_by,
    created_at,
    updated_at
)
SELECT
    s.project_id,
    st.field_id,
    s.slot_date,
    s.start_time,
    s.end_time,
    s.timezone,
    s.is_active,
    s.created_by,
    s.created_at,
    now()
FROM public.project_availability_slots s
JOIN public.project_availability_step_settings st
  ON st.project_id = s.project_id
 AND st.is_enabled IS TRUE
WHERE s.field_id IS NULL
ON CONFLICT (project_id, field_id, slot_date, start_time) DO NOTHING;

ALTER TABLE public.project_availability_step_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_availability_consultants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_availability_step_settings_select ON public.project_availability_step_settings;
DROP POLICY IF EXISTS project_availability_step_settings_insert ON public.project_availability_step_settings;
DROP POLICY IF EXISTS project_availability_step_settings_update ON public.project_availability_step_settings;
DROP POLICY IF EXISTS project_availability_step_settings_delete ON public.project_availability_step_settings;

CREATE POLICY project_availability_step_settings_select ON public.project_availability_step_settings
FOR SELECT TO authenticated
USING (public.can_access_project(project_id));

CREATE POLICY project_availability_step_settings_insert ON public.project_availability_step_settings
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_step_settings_update ON public.project_availability_step_settings
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_step_settings_delete ON public.project_availability_step_settings
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));

DROP POLICY IF EXISTS project_availability_consultants_select ON public.project_availability_consultants;
DROP POLICY IF EXISTS project_availability_consultants_insert ON public.project_availability_consultants;
DROP POLICY IF EXISTS project_availability_consultants_update ON public.project_availability_consultants;
DROP POLICY IF EXISTS project_availability_consultants_delete ON public.project_availability_consultants;

CREATE POLICY project_availability_consultants_select ON public.project_availability_consultants
FOR SELECT TO authenticated
USING (public.can_access_project(project_id));

CREATE POLICY project_availability_consultants_insert ON public.project_availability_consultants
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_consultants_update ON public.project_availability_consultants
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_consultants_delete ON public.project_availability_consultants
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));

DROP FUNCTION IF EXISTS public.get_project_availability_slots(uuid);

CREATE OR REPLACE FUNCTION public.get_project_availability_slots(p_project_id uuid)
RETURNS TABLE (
    id uuid,
    project_id uuid,
    field_id uuid,
    slot_date date,
    start_time time,
    end_time time,
    timezone text,
    is_booked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.can_access_project(p_project_id) THEN
        RAISE EXCEPTION 'Not allowed to view this project availability';
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.project_id,
        s.field_id,
        s.slot_date,
        s.start_time,
        s.end_time,
        s.timezone,
        EXISTS (
            SELECT 1
            FROM public.project_availability_bookings b
            WHERE b.slot_id = s.id
              AND b.status = 'booked'
        ) AS is_booked
    FROM public.project_availability_slots s
    JOIN public.project_availability_step_settings st
      ON st.project_id = s.project_id
     AND st.field_id = s.field_id
     AND st.is_enabled IS TRUE
    WHERE s.project_id = p_project_id
      AND s.field_id IS NOT NULL
      AND s.is_active IS TRUE
    ORDER BY s.field_id, s.slot_date, s.start_time;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_availability_slots(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.book_project_availability_slot(
    p_record_id uuid,
    p_field_id uuid,
    p_slot_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id uuid;
    v_slot_project_id uuid;
    v_slot_field_id uuid;
    v_field_project_id uuid;
    v_field_type text;
    v_booking_id uuid;
BEGIN
    SELECT r.project_id
      INTO v_project_id
      FROM public.records r
     WHERE r.id = p_record_id
       AND r.active IS NOT FALSE;

    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Record not found or inactive';
    END IF;

    IF NOT (public.owns_record(p_record_id) OR public.can_edit_record(p_record_id)) THEN
        RAISE EXCEPTION 'Not allowed to book this record';
    END IF;

    SELECT s.project_id, s.field_id
      INTO v_slot_project_id, v_slot_field_id
      FROM public.project_availability_slots s
     WHERE s.id = p_slot_id
       AND s.is_active IS TRUE;

    IF v_slot_project_id IS NULL THEN
        RAISE EXCEPTION 'Availability slot not found';
    END IF;

    SELECT f.project_id, f.type
      INTO v_field_project_id, v_field_type
      FROM public.fields f
     WHERE f.id = p_field_id
       AND COALESCE(f.field_role, '') <> 'overall_status';

    IF v_field_project_id IS NULL THEN
        RAISE EXCEPTION 'Booking field not found';
    END IF;

    IF v_project_id <> v_slot_project_id OR v_project_id <> v_field_project_id THEN
        RAISE EXCEPTION 'Booking slot, field, and record must belong to the same project';
    END IF;

    IF v_slot_field_id IS DISTINCT FROM p_field_id THEN
        RAISE EXCEPTION 'Availability slot does not belong to this booking step';
    END IF;

    IF COALESCE(v_field_type, '') <> 'select' THEN
        RAISE EXCEPTION 'Booking field must be a select step';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.project_availability_step_settings st
        WHERE st.project_id = v_project_id
          AND st.field_id = p_field_id
          AND st.is_enabled IS TRUE
    ) THEN
        RAISE EXCEPTION 'Booking is not enabled for this step';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_slot_id::text));

    INSERT INTO public.project_availability_bookings (
        project_id,
        slot_id,
        record_id,
        field_id,
        status,
        booked_by,
        booked_at,
        notification_sent_at,
        notification_error
    )
    VALUES (
        v_project_id,
        p_slot_id,
        p_record_id,
        p_field_id,
        'booked',
        auth.uid(),
        now(),
        NULL,
        NULL
    )
    ON CONFLICT (record_id, field_id) WHERE status = 'booked'
    DO UPDATE SET
        slot_id = EXCLUDED.slot_id,
        booked_by = EXCLUDED.booked_by,
        booked_at = now(),
        updated_at = now(),
        notification_sent_at = NULL,
        notification_error = NULL
    RETURNING id INTO v_booking_id;

    INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
    VALUES (p_record_id, p_field_id, NULL, 'Completed')
    ON CONFLICT (record_id, field_id)
    DO UPDATE SET
        value_text = NULL,
        value_select = EXCLUDED.value_select;

    UPDATE public.records
       SET updated_by = auth.uid(),
           updated_at = now()
     WHERE id = p_record_id;

    RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_project_availability_slot(uuid, uuid, uuid) TO authenticated;
