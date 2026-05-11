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
    v_record_values_has_updated_at boolean := false;
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

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'record_values'
          AND column_name = 'updated_at'
    )
    INTO v_record_values_has_updated_at;

    IF v_record_values_has_updated_at THEN
        INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
        VALUES (p_record_id, p_field_id, NULL, 'Completed')
        ON CONFLICT (record_id, field_id)
        DO UPDATE SET
            value_text = NULL,
            value_select = EXCLUDED.value_select,
            updated_at = now();
    ELSE
        INSERT INTO public.record_values (record_id, field_id, value_text, value_select)
        VALUES (p_record_id, p_field_id, NULL, 'Completed')
        ON CONFLICT (record_id, field_id)
        DO UPDATE SET
            value_text = NULL,
            value_select = EXCLUDED.value_select;
    END IF;

    UPDATE public.records
       SET updated_by = auth.uid(),
           updated_at = now()
     WHERE id = p_record_id;

    RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_project_availability_slot(uuid, uuid, uuid) TO authenticated;
