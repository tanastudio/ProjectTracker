CREATE OR REPLACE FUNCTION public.project_availability_booking_has_live_slot(p_booking public.project_availability_bookings)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.project_availability_slots s
        JOIN public.project_availability_consultants c
          ON c.id = s.consultant_id
         AND c.is_active IS TRUE
        WHERE s.id = p_booking.slot_id
          AND s.project_id = p_booking.project_id
          AND s.field_id = p_booking.field_id
          AND s.is_active IS TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.cancel_unmanaged_project_availability_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cancelled record;
    v_count integer := 0;
BEGIN
    FOR v_cancelled IN
        UPDATE public.project_availability_bookings b
           SET status = 'cancelled',
               updated_at = now()
         WHERE b.status = 'booked'
           AND NOT public.project_availability_booking_has_live_slot(b)
         RETURNING b.record_id, b.field_id
    LOOP
        v_count := v_count + 1;

        UPDATE public.record_values rv
           SET value_text = NULL,
               value_select = 'Not Started'
         WHERE rv.record_id = v_cancelled.record_id
           AND rv.field_id = v_cancelled.field_id;

        UPDATE public.records r
           SET updated_at = now()
         WHERE r.id = v_cancelled.record_id;
    END LOOP;

    UPDATE public.project_availability_slots s
       SET is_active = false,
           updated_at = now()
     WHERE s.is_active IS TRUE
       AND (
            s.field_id IS NULL
            OR s.consultant_id IS NULL
            OR NOT EXISTS (
                SELECT 1
                FROM public.project_availability_consultants c
                WHERE c.id = s.consultant_id
                  AND c.is_active IS TRUE
            )
       );

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_unmanaged_project_availability_bookings() TO authenticated;

SELECT public.cancel_unmanaged_project_availability_bookings();
