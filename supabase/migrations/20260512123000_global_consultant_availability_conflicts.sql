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
    WITH bounds AS (
        SELECT
            public.project_availability_slot_instant(
                p_left_date,
                COALESCE(p_left_start, p_left_end),
                p_left_timezone
            ) AS left_start_at,
            CASE
                WHEN p_left_end IS NULL THEN
                    public.project_availability_slot_instant(p_left_date, p_left_start, p_left_timezone) + interval '1 minute'
                ELSE
                    public.project_availability_slot_instant(p_left_date, p_left_end, p_left_timezone)
            END AS left_end_at,
            public.project_availability_slot_instant(
                p_right_date,
                COALESCE(p_right_start, p_right_end),
                p_right_timezone
            ) AS right_start_at,
            CASE
                WHEN p_right_end IS NULL THEN
                    public.project_availability_slot_instant(p_right_date, p_right_start, p_right_timezone) + interval '1 minute'
                ELSE
                    public.project_availability_slot_instant(p_right_date, p_right_end, p_right_timezone)
            END AS right_end_at
    )
    SELECT left_start_at < right_end_at
       AND right_start_at < left_end_at
    FROM bounds;
$$;

CREATE OR REPLACE FUNCTION public.raise_if_availability_slot_consultant_conflict(
    p_project_id uuid,
    p_field_id uuid,
    p_consultant_id uuid,
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
    v_consultant_email text;
    v_conflict_project text;
    v_conflict_label text;
    v_conflict_date date;
    v_conflict_start time;
    v_conflict_end time;
BEGIN
    IF p_field_id IS NULL THEN
        RETURN;
    END IF;

    IF p_consultant_id IS NULL THEN
        RAISE EXCEPTION 'Select a consultant before creating availability slots';
    END IF;

    SELECT lower(c.email)
      INTO v_consultant_email
      FROM public.project_availability_consultants c
     WHERE c.id = p_consultant_id
       AND c.project_id = p_project_id
       AND c.field_id = p_field_id
       AND c.is_active IS TRUE;

    IF v_consultant_email IS NULL THEN
        RAISE EXCEPTION 'Select an active consultant before creating availability slots';
    END IF;

    SELECT
        p.name AS project_name,
        f.label AS field_label,
        s.slot_date,
        s.start_time,
        s.end_time
      INTO v_conflict_project, v_conflict_label, v_conflict_date, v_conflict_start, v_conflict_end
      FROM public.project_availability_slots s
      JOIN public.project_availability_consultants c
        ON c.id = s.consultant_id
       AND c.is_active IS TRUE
       AND lower(c.email) = v_consultant_email
      LEFT JOIN public.fields f
        ON f.id = s.field_id
      LEFT JOIN public.projects p
        ON p.id = s.project_id
     WHERE s.is_active IS TRUE
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

    IF v_conflict_date IS NOT NULL THEN
        RAISE EXCEPTION 'Consultant % already has an overlapping slot in % / % on % %-%',
            v_consultant_email,
            COALESCE(v_conflict_project, 'another project'),
            COALESCE(v_conflict_label, 'another booking step'),
            v_conflict_date,
            v_conflict_start,
            v_conflict_end;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_project_availability_consultant_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conflict_project text;
    v_conflict_label text;
    v_conflict_date date;
    v_conflict_start time;
    v_conflict_end time;
BEGIN
    IF NEW.is_active IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    SELECT p.name, f.label, other_slot.slot_date, other_slot.start_time, other_slot.end_time
      INTO v_conflict_project, v_conflict_label, v_conflict_date, v_conflict_start, v_conflict_end
      FROM public.project_availability_slots s
      JOIN public.project_availability_slots other_slot
        ON other_slot.is_active IS TRUE
       AND other_slot.id <> s.id
      JOIN public.project_availability_consultants other_consultant
        ON other_consultant.id = other_slot.consultant_id
       AND other_consultant.is_active IS TRUE
       AND lower(other_consultant.email) = lower(NEW.email)
      LEFT JOIN public.fields f
        ON f.id = other_slot.field_id
      LEFT JOIN public.projects p
        ON p.id = other_slot.project_id
     WHERE s.consultant_id = NEW.id
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
        RAISE EXCEPTION 'Consultant % already has an overlapping slot in % / % on % %-%',
            lower(NEW.email),
            COALESCE(v_conflict_project, 'another project'),
            COALESCE(v_conflict_label, 'another booking step'),
            v_conflict_date,
            v_conflict_start,
            v_conflict_end;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_project_availability_slot_v2(
    p_record_id uuid,
    p_field_id uuid,
    p_slot_id uuid,
    p_candidate_slot_ids uuid[] DEFAULT NULL
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
    v_candidate_ids uuid[];
    v_candidate record;
    v_booking_id uuid;
    v_selected_slot_id uuid;
    v_selected_consultant_id uuid;
    v_selected_consultant_name text;
    v_selected_consultant_email text;
BEGIN
    IF p_slot_id IS NULL THEN
        RAISE EXCEPTION 'Availability slot is required';
    END IF;

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

    v_candidate_ids := COALESCE(p_candidate_slot_ids, ARRAY[]::uuid[]);
    IF array_length(v_candidate_ids, 1) IS NULL THEN
        v_candidate_ids := ARRAY[p_slot_id];
    ELSIF NOT p_slot_id = ANY(v_candidate_ids) THEN
        v_candidate_ids := array_append(v_candidate_ids, p_slot_id);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_record_id::text || ':' || p_field_id::text));

    FOR v_candidate IN
        WITH candidate_slots AS (
            SELECT
                s.id AS slot_id,
                s.slot_date,
                s.start_time,
                s.end_time,
                s.timezone,
                c.id AS consultant_id,
                COALESCE(NULLIF(c.name, ''), c.email) AS consultant_name,
                lower(c.email) AS consultant_email,
                c.sort_order AS consultant_sort_order
            FROM public.project_availability_slots s
            JOIN public.project_availability_consultants c
              ON c.id = s.consultant_id
             AND c.is_active IS TRUE
            WHERE s.id = ANY(v_candidate_ids)
              AND s.project_id = v_project_id
              AND s.field_id = p_field_id
              AND s.is_active IS TRUE
        )
        SELECT
            cs.*,
            (
                SELECT count(*)::integer
                FROM public.project_availability_bookings b
                WHERE b.status = 'booked'
                  AND lower(COALESCE(b.consultant_email, '')) = cs.consultant_email
            ) AS consultant_booking_count
        FROM candidate_slots cs
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.project_availability_bookings b
            WHERE b.slot_id = cs.slot_id
              AND b.status = 'booked'
              AND NOT (b.record_id = p_record_id AND b.field_id = p_field_id)
        )
        ORDER BY consultant_booking_count, consultant_sort_order, consultant_name, consultant_email, slot_id
    LOOP
        PERFORM pg_advisory_xact_lock(hashtext(v_candidate.slot_id::text));
        PERFORM pg_advisory_xact_lock(hashtext('availability-consultant:' || v_candidate.consultant_email));

        IF EXISTS (
            SELECT 1
            FROM public.project_availability_bookings b
            WHERE b.slot_id = v_candidate.slot_id
              AND b.status = 'booked'
              AND NOT (b.record_id = p_record_id AND b.field_id = p_field_id)
        ) THEN
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.project_availability_bookings b
            JOIN public.project_availability_slots booked_slot
              ON booked_slot.id = b.slot_id
             AND booked_slot.is_active IS TRUE
            WHERE b.status = 'booked'
              AND lower(COALESCE(b.consultant_email, '')) = v_candidate.consultant_email
              AND NOT (b.record_id = p_record_id AND b.field_id = p_field_id)
              AND public.project_availability_slot_overlaps(
                    v_candidate.slot_date,
                    v_candidate.start_time,
                    v_candidate.end_time,
                    v_candidate.timezone,
                    booked_slot.slot_date,
                    booked_slot.start_time,
                    booked_slot.end_time,
                    booked_slot.timezone
              )
        ) THEN
            CONTINUE;
        END IF;

        v_selected_slot_id := v_candidate.slot_id;
        v_selected_consultant_id := v_candidate.consultant_id;
        v_selected_consultant_name := v_candidate.consultant_name;
        v_selected_consultant_email := v_candidate.consultant_email;
        EXIT;
    END LOOP;

    IF v_selected_slot_id IS NULL THEN
        RAISE EXCEPTION 'This time is no longer available. Please choose another slot.';
    END IF;

    INSERT INTO public.project_availability_bookings (
        project_id,
        slot_id,
        record_id,
        field_id,
        consultant_id,
        consultant_name,
        consultant_email,
        status,
        booked_by,
        booked_at,
        notification_sent_at,
        notification_error
    )
    VALUES (
        v_project_id,
        v_selected_slot_id,
        p_record_id,
        p_field_id,
        v_selected_consultant_id,
        v_selected_consultant_name,
        v_selected_consultant_email,
        'booked',
        auth.uid(),
        now(),
        NULL,
        NULL
    )
    ON CONFLICT (record_id, field_id) WHERE status = 'booked'
    DO UPDATE SET
        slot_id = EXCLUDED.slot_id,
        consultant_id = EXCLUDED.consultant_id,
        consultant_name = EXCLUDED.consultant_name,
        consultant_email = EXCLUDED.consultant_email,
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

GRANT EXECUTE ON FUNCTION public.book_project_availability_slot_v2(uuid, uuid, uuid, uuid[]) TO authenticated;
