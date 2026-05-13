CREATE INDEX IF NOT EXISTS idx_project_availability_consultants_active_email
    ON public.project_availability_consultants (lower(email))
    WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_project_availability_slots_active_consultant_date
    ON public.project_availability_slots (consultant_id, slot_date, start_time)
    WHERE is_active IS TRUE;

DROP FUNCTION IF EXISTS public.get_project_global_consultant_availability_slots_for_settings(uuid);

CREATE OR REPLACE FUNCTION public.get_project_global_consultant_availability_slots_for_settings(
    p_project_id uuid
)
RETURNS TABLE (
    id uuid,
    project_id uuid,
    project_name text,
    field_id uuid,
    field_label text,
    field_key text,
    consultant_id uuid,
    consultant_name text,
    consultant_email text,
    consultant_sort_order integer,
    slot_date date,
    start_time time,
    end_time time,
    timezone text,
    is_active boolean,
    booking_id uuid,
    booking_project_id uuid,
    booking_record_id uuid,
    booking_field_id uuid,
    booking_consultant_id uuid,
    booking_consultant_name text,
    booking_consultant_email text,
    booking_status text,
    booked_at timestamptz,
    record_code text,
    record_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.can_edit_project(p_project_id) THEN
        RAISE EXCEPTION 'Not allowed to view global project availability';
    END IF;

    RETURN QUERY
    WITH current_consultants AS (
        SELECT DISTINCT lower(trim(c.email)) AS email
        FROM public.project_availability_consultants c
        WHERE c.project_id = p_project_id
          AND c.is_active IS TRUE
          AND trim(COALESCE(c.email, '')) <> ''
    )
    SELECT
        s.id,
        s.project_id,
        p.name AS project_name,
        s.field_id,
        f.label AS field_label,
        f.key AS field_key,
        c.id AS consultant_id,
        COALESCE(NULLIF(c.name, ''), c.email) AS consultant_name,
        lower(c.email) AS consultant_email,
        c.sort_order AS consultant_sort_order,
        s.slot_date,
        s.start_time,
        s.end_time,
        s.timezone,
        s.is_active,
        b.id AS booking_id,
        b.project_id AS booking_project_id,
        b.record_id AS booking_record_id,
        b.field_id AS booking_field_id,
        b.consultant_id AS booking_consultant_id,
        b.consultant_name AS booking_consultant_name,
        b.consultant_email AS booking_consultant_email,
        b.status AS booking_status,
        b.booked_at,
        r.code AS record_code,
        r.title AS record_title
    FROM public.project_availability_slots s
    JOIN public.project_availability_consultants c
      ON c.id = s.consultant_id
     AND c.is_active IS TRUE
    JOIN current_consultants current_c
      ON current_c.email = lower(c.email)
    LEFT JOIN public.projects p
      ON p.id = s.project_id
    LEFT JOIN public.fields f
      ON f.id = s.field_id
    LEFT JOIN LATERAL (
        SELECT b.*
        FROM public.project_availability_bookings b
        WHERE b.slot_id = s.id
          AND b.status = 'booked'
        ORDER BY b.booked_at DESC NULLS LAST, b.created_at DESC NULLS LAST
        LIMIT 1
    ) b ON true
    LEFT JOIN public.records r
      ON r.id = b.record_id
    WHERE s.is_active IS TRUE
    ORDER BY
        s.slot_date,
        s.start_time,
        COALESCE(p.name, ''),
        COALESCE(f.sort_order, 0),
        COALESCE(f.label, f.key, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_global_consultant_availability_slots_for_settings(uuid) TO authenticated;
