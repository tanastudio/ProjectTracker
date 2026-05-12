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
    v_cancel_booking boolean := COALESCE(p_cancel_booking, true);
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

    IF v_cancel_booking IS NOT TRUE THEN
        NULL;
    END IF;

    PERFORM public.cancel_bookings_for_removed_availability_slot(v_slot.id, v_slot.project_id);

    UPDATE public.project_availability_slots
       SET is_active = false,
           updated_at = now()
     WHERE id = p_slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_project_availability_slot(uuid, boolean) TO authenticated;
