CREATE OR REPLACE FUNCTION public.project_availability_slot_instant(
    p_slot_date date,
    p_slot_time time,
    p_timezone text
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
    SELECT make_timestamptz(
        EXTRACT(year FROM p_slot_date)::int,
        EXTRACT(month FROM p_slot_date)::int,
        EXTRACT(day FROM p_slot_date)::int,
        EXTRACT(hour FROM p_slot_time)::int,
        EXTRACT(minute FROM p_slot_time)::int,
        EXTRACT(second FROM p_slot_time)::double precision,
        COALESCE(NULLIF(p_timezone, ''), 'Asia/Bangkok')
    );
$$;

CREATE OR REPLACE FUNCTION public.project_availability_slot_overlaps(
    p_left_date date,
    p_left_start time,
    p_left_end time,
    p_left_timezone text,
    p_right_date date,
    p_right_start time,
    p_right_end time,
    p_right_timezone text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT
        public.project_availability_slot_instant(p_left_date, COALESCE(p_left_start, p_left_end), p_left_timezone)
            < public.project_availability_slot_instant(p_right_date, COALESCE(p_right_end, p_right_start) + CASE WHEN p_right_end IS NULL THEN interval '1 minute' ELSE interval '0 minute' END, p_right_timezone)
        AND
        public.project_availability_slot_instant(p_right_date, COALESCE(p_right_start, p_right_end), p_right_timezone)
            < public.project_availability_slot_instant(p_left_date, COALESCE(p_left_end, p_left_start) + CASE WHEN p_left_end IS NULL THEN interval '1 minute' ELSE interval '0 minute' END, p_left_timezone);
$$;

CREATE OR REPLACE FUNCTION public.raise_if_availability_slot_consultant_conflict(
    p_project_id uuid,
    p_field_id uuid,
    p_slot_id uuid,
    p_slot_date date,
    p_start_time time,
    p_end_time time,
    p_timezone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conflict_email text;
    v_conflict_label text;
    v_conflict_date date;
    v_conflict_start time;
    v_conflict_end time;
BEGIN
    IF p_field_id IS NULL THEN
        RETURN;
    END IF;

    SELECT
        lower(c_new.email) AS consultant_email,
        f.label AS field_label,
        s.slot_date,
        s.start_time,
        s.end_time
      INTO v_conflict_email, v_conflict_label, v_conflict_date, v_conflict_start, v_conflict_end
      FROM public.project_availability_consultants c_new
      JOIN public.project_availability_consultants c_existing
        ON c_existing.project_id = c_new.project_id
       AND c_existing.is_active IS TRUE
       AND lower(c_existing.email) = lower(c_new.email)
      JOIN public.project_availability_slots s
        ON s.project_id = c_existing.project_id
       AND s.field_id = c_existing.field_id
       AND s.is_active IS TRUE
      LEFT JOIN public.fields f
        ON f.id = s.field_id
     WHERE c_new.project_id = p_project_id
       AND c_new.field_id = p_field_id
       AND c_new.is_active IS TRUE
       AND s.id IS DISTINCT FROM p_slot_id
       AND public.project_availability_slot_overlaps(
            p_slot_date,
            p_start_time,
            p_end_time,
            p_timezone,
            s.slot_date,
            s.start_time,
            s.end_time,
            s.timezone
       )
     LIMIT 1;

    IF v_conflict_email IS NOT NULL THEN
        RAISE EXCEPTION 'Consultant % already has an overlapping slot in % on % %-%',
            v_conflict_email,
            COALESCE(v_conflict_label, 'another booking step'),
            v_conflict_date,
            v_conflict_start,
            v_conflict_end;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_project_availability_slot_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_active IS TRUE THEN
        PERFORM public.raise_if_availability_slot_consultant_conflict(
            NEW.project_id,
            NEW.field_id,
            NEW.id,
            NEW.slot_date,
            NEW.start_time,
            NEW.end_time,
            NEW.timezone
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_availability_slot_conflict ON public.project_availability_slots;
CREATE TRIGGER trg_project_availability_slot_conflict
BEFORE INSERT OR UPDATE OF field_id, slot_date, start_time, end_time, timezone, is_active
ON public.project_availability_slots
FOR EACH ROW
EXECUTE FUNCTION public.trg_project_availability_slot_conflict();

CREATE OR REPLACE FUNCTION public.trg_project_availability_consultant_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conflict_label text;
    v_conflict_date date;
    v_conflict_start time;
    v_conflict_end time;
BEGIN
    IF NEW.is_active IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    SELECT s.slot_date, s.start_time, s.end_time, f.label AS field_label
      INTO v_conflict_date, v_conflict_start, v_conflict_end, v_conflict_label
      FROM public.project_availability_slots s
      JOIN public.project_availability_slots other_slot
        ON other_slot.project_id = s.project_id
       AND other_slot.is_active IS TRUE
       AND other_slot.id <> s.id
      JOIN public.project_availability_consultants other_consultant
        ON other_consultant.project_id = other_slot.project_id
       AND other_consultant.field_id = other_slot.field_id
       AND other_consultant.is_active IS TRUE
       AND lower(other_consultant.email) = lower(NEW.email)
      LEFT JOIN public.fields f
        ON f.id = other_slot.field_id
     WHERE s.project_id = NEW.project_id
       AND s.field_id = NEW.field_id
       AND s.is_active IS TRUE
       AND public.project_availability_slot_overlaps(
            s.slot_date,
            s.start_time,
            s.end_time,
            s.timezone,
            other_slot.slot_date,
            other_slot.start_time,
            other_slot.end_time,
            other_slot.timezone
       )
     LIMIT 1;

    IF v_conflict_date IS NOT NULL THEN
        RAISE EXCEPTION 'Consultant % already has an overlapping slot in % on % %-%',
            lower(NEW.email),
            COALESCE(v_conflict_label, 'another booking step'),
            v_conflict_date,
            v_conflict_start,
            v_conflict_end;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_availability_consultant_conflict ON public.project_availability_consultants;
CREATE TRIGGER trg_project_availability_consultant_conflict
BEFORE INSERT OR UPDATE OF project_id, field_id, email, is_active
ON public.project_availability_consultants
FOR EACH ROW
EXECUTE FUNCTION public.trg_project_availability_consultant_conflict();

CREATE OR REPLACE FUNCTION public.replace_project_availability_consultants(
    p_project_id uuid,
    p_field_id uuid,
    p_consultants jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.can_edit_project(p_project_id) THEN
        RAISE EXCEPTION 'Not allowed to manage consultants for this project';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.fields f
        WHERE f.id = p_field_id
          AND f.project_id = p_project_id
          AND COALESCE(f.field_role, '') <> 'overall_status'
    ) THEN
        RAISE EXCEPTION 'Booking field not found';
    END IF;

    DELETE FROM public.project_availability_consultants
    WHERE project_id = p_project_id
      AND field_id = p_field_id;

    INSERT INTO public.project_availability_consultants (
        project_id,
        field_id,
        name,
        email,
        is_active,
        sort_order,
        updated_at
    )
    SELECT
        p_project_id,
        p_field_id,
        COALESCE(NULLIF(trim(item.value->>'name'), ''), lower(trim(item.value->>'email'))),
        lower(trim(item.value->>'email')),
        true,
        item.ordinality::int - 1,
        now()
    FROM jsonb_array_elements(COALESCE(p_consultants, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
    WHERE trim(COALESCE(item.value->>'email', '')) <> '';
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_project_availability_consultants(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_project_availability_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking record;
BEGIN
    SELECT *
      INTO v_booking
      FROM public.project_availability_bookings
     WHERE id = p_booking_id
       AND status = 'booked'
     FOR UPDATE;

    IF v_booking.id IS NULL THEN
        RAISE EXCEPTION 'Active booking not found';
    END IF;

    IF NOT public.can_edit_project(v_booking.project_id) THEN
        RAISE EXCEPTION 'Not allowed to cancel this booking';
    END IF;

    UPDATE public.project_availability_bookings
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = p_booking_id;

    UPDATE public.record_values
       SET value_text = NULL,
           value_select = 'Not Started'
     WHERE record_id = v_booking.record_id
       AND field_id = v_booking.field_id;

    UPDATE public.records
       SET updated_by = auth.uid(),
           updated_at = now()
     WHERE id = v_booking.record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_project_availability_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_project_availability_slot(
    p_slot_id uuid,
    p_cancel_booking boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot record;
    v_booking_id uuid;
BEGIN
    SELECT *
      INTO v_slot
      FROM public.project_availability_slots
     WHERE id = p_slot_id
     FOR UPDATE;

    IF v_slot.id IS NULL THEN
        RAISE EXCEPTION 'Availability slot not found';
    END IF;

    IF NOT public.can_edit_project(v_slot.project_id) THEN
        RAISE EXCEPTION 'Not allowed to remove this slot';
    END IF;

    SELECT b.id
      INTO v_booking_id
      FROM public.project_availability_bookings b
     WHERE b.slot_id = p_slot_id
       AND b.status = 'booked'
     LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
        IF p_cancel_booking IS NOT TRUE THEN
            RAISE EXCEPTION 'This slot has an active booking. Cancel the booking first or confirm cancel and remove.';
        END IF;
        PERFORM public.cancel_project_availability_booking(v_booking_id);
    END IF;

    UPDATE public.project_availability_slots
       SET is_active = false,
           updated_at = now()
     WHERE id = p_slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_project_availability_slot(uuid, boolean) TO authenticated;

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
    v_slot_date date;
    v_start_time time;
    v_end_time time;
    v_timezone text;
    v_field_project_id uuid;
    v_field_type text;
    v_booking_id uuid;
    v_conflict_email text;
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

    SELECT s.project_id, s.field_id, s.slot_date, s.start_time, s.end_time, s.timezone
      INTO v_slot_project_id, v_slot_field_id, v_slot_date, v_start_time, v_end_time, v_timezone
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

    SELECT lower(c_new.email) AS consultant_email
      INTO v_conflict_email
      FROM public.project_availability_consultants c_new
      JOIN public.project_availability_consultants c_existing
        ON c_existing.project_id = c_new.project_id
       AND c_existing.is_active IS TRUE
       AND lower(c_existing.email) = lower(c_new.email)
      JOIN public.project_availability_slots s_existing
        ON s_existing.project_id = c_existing.project_id
       AND s_existing.field_id = c_existing.field_id
       AND s_existing.is_active IS TRUE
      JOIN public.project_availability_bookings b
        ON b.slot_id = s_existing.id
       AND b.status = 'booked'
     WHERE c_new.project_id = v_project_id
       AND c_new.field_id = p_field_id
       AND c_new.is_active IS TRUE
       AND NOT (b.record_id = p_record_id AND b.field_id = p_field_id)
       AND public.project_availability_slot_overlaps(
            v_slot_date,
            v_start_time,
            v_end_time,
            v_timezone,
            s_existing.slot_date,
            s_existing.start_time,
            s_existing.end_time,
            s_existing.timezone
       )
     LIMIT 1;

    IF v_conflict_email IS NOT NULL THEN
        RAISE EXCEPTION 'Consultant % already has a booking at this time', v_conflict_email;
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
