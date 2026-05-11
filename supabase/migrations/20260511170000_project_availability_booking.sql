-- Project-level availability slots and participant bookings.

CREATE TABLE IF NOT EXISTS public.project_availability_slots (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    slot_date   date        NOT NULL,
    start_time  time        NOT NULL,
    end_time    time,
    timezone    text        NOT NULL DEFAULT 'Asia/Bangkok',
    is_active   boolean     NOT NULL DEFAULT true,
    created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_availability_slots_time_check CHECK (end_time IS NULL OR end_time > start_time),
    UNIQUE (project_id, slot_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_project_availability_slots_project_date
    ON public.project_availability_slots(project_id, slot_date, start_time);

CREATE TABLE IF NOT EXISTS public.project_availability_bookings (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    slot_id               uuid        NOT NULL REFERENCES public.project_availability_slots(id) ON DELETE RESTRICT,
    record_id             uuid        NOT NULL REFERENCES public.records(id) ON DELETE CASCADE,
    field_id              uuid        NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    status                text        NOT NULL DEFAULT 'booked',
    booked_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    booked_at             timestamptz NOT NULL DEFAULT now(),
    notification_sent_at  timestamptz,
    notification_error    text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_availability_bookings_status_check CHECK (status IN ('booked', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_project_availability_bookings_record_field
    ON public.project_availability_bookings(record_id, field_id);

CREATE INDEX IF NOT EXISTS idx_project_availability_bookings_project
    ON public.project_availability_bookings(project_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS project_availability_bookings_active_slot_uidx
    ON public.project_availability_bookings(slot_id)
    WHERE status = 'booked';

CREATE UNIQUE INDEX IF NOT EXISTS project_availability_bookings_active_record_field_uidx
    ON public.project_availability_bookings(record_id, field_id)
    WHERE status = 'booked';

ALTER TABLE public.project_availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_availability_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_availability_slots_select ON public.project_availability_slots;
DROP POLICY IF EXISTS project_availability_slots_insert ON public.project_availability_slots;
DROP POLICY IF EXISTS project_availability_slots_update ON public.project_availability_slots;
DROP POLICY IF EXISTS project_availability_slots_delete ON public.project_availability_slots;

CREATE POLICY project_availability_slots_select ON public.project_availability_slots
FOR SELECT TO authenticated
USING (public.can_access_project(project_id));

CREATE POLICY project_availability_slots_insert ON public.project_availability_slots
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_slots_update ON public.project_availability_slots
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY project_availability_slots_delete ON public.project_availability_slots
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));

DROP POLICY IF EXISTS project_availability_bookings_select ON public.project_availability_bookings;
DROP POLICY IF EXISTS project_availability_bookings_insert ON public.project_availability_bookings;
DROP POLICY IF EXISTS project_availability_bookings_update ON public.project_availability_bookings;
DROP POLICY IF EXISTS project_availability_bookings_delete ON public.project_availability_bookings;

CREATE POLICY project_availability_bookings_select ON public.project_availability_bookings
FOR SELECT TO authenticated
USING (public.can_access_record(record_id));

CREATE POLICY project_availability_bookings_insert ON public.project_availability_bookings
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_record(record_id));

CREATE POLICY project_availability_bookings_update ON public.project_availability_bookings
FOR UPDATE TO authenticated
USING (public.can_edit_record(record_id))
WITH CHECK (public.can_edit_record(record_id));

CREATE POLICY project_availability_bookings_delete ON public.project_availability_bookings
FOR DELETE TO authenticated
USING (public.can_edit_record(record_id));

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

    SELECT s.project_id
      INTO v_slot_project_id
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

    IF COALESCE(v_field_type, '') <> 'select' THEN
        RAISE EXCEPTION 'Booking field must be a select step';
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

    INSERT INTO public.record_values (record_id, field_id, value_text, value_select, updated_at)
    VALUES (p_record_id, p_field_id, NULL, 'Completed', now())
    ON CONFLICT (record_id, field_id)
    DO UPDATE SET
        value_text = NULL,
        value_select = 'Completed',
        updated_at = now();

    UPDATE public.records
       SET updated_by = auth.uid(),
           updated_at = now()
     WHERE id = p_record_id;

    RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_project_availability_slot(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_project_availability_slots(p_project_id uuid)
RETURNS TABLE (
    id uuid,
    project_id uuid,
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
    WHERE s.project_id = p_project_id
      AND s.is_active IS TRUE
    ORDER BY s.slot_date, s.start_time;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_availability_slots(uuid) TO authenticated;
