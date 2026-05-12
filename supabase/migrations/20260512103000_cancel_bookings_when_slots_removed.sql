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

CREATE OR REPLACE FUNCTION public.cancel_bookings_for_removed_availability_slot(
    p_slot_id uuid,
    p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cancelled record;
BEGIN
    FOR v_cancelled IN
        UPDATE public.project_availability_bookings b
           SET status = 'cancelled',
               updated_at = now()
         WHERE b.slot_id = p_slot_id
           AND b.status = 'booked'
         RETURNING b.record_id, b.field_id
    LOOP
        UPDATE public.record_values rv
           SET value_text = NULL,
               value_select = 'Not Started'
         WHERE rv.record_id = v_cancelled.record_id
           AND rv.field_id = v_cancelled.field_id;

        UPDATE public.records r
           SET updated_by = auth.uid(),
               updated_at = now()
         WHERE r.id = v_cancelled.record_id
           AND r.project_id = p_project_id;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_cancel_booking_when_availability_slot_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
        PERFORM public.cancel_bookings_for_removed_availability_slot(NEW.id, NEW.project_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_booking_when_availability_slot_removed ON public.project_availability_slots;
CREATE TRIGGER trg_cancel_booking_when_availability_slot_removed
AFTER UPDATE OF is_active
ON public.project_availability_slots
FOR EACH ROW
EXECUTE FUNCTION public.trg_cancel_booking_when_availability_slot_removed();

CREATE OR REPLACE FUNCTION public.remove_project_availability_slot(
    p_slot_id uuid,
    p_cancel_booking boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot record;
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

    PERFORM public.cancel_bookings_for_removed_availability_slot(v_slot.id, v_slot.project_id);

    UPDATE public.project_availability_slots
       SET is_active = false,
           updated_at = now()
     WHERE id = p_slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_project_availability_slot(uuid, boolean) TO authenticated;

WITH stale_bookings AS (
    UPDATE public.project_availability_bookings b
       SET status = 'cancelled',
           updated_at = now()
      FROM public.project_availability_slots s
     WHERE b.slot_id = s.id
       AND b.status = 'booked'
       AND s.is_active IS NOT TRUE
     RETURNING b.record_id, b.field_id
)
UPDATE public.record_values rv
   SET value_text = NULL,
       value_select = 'Not Started'
  FROM stale_bookings sb
 WHERE rv.record_id = sb.record_id
   AND rv.field_id = sb.field_id;
