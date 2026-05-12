ALTER TABLE public.project_availability_slots
    ADD COLUMN IF NOT EXISTS consultant_id uuid REFERENCES public.project_availability_consultants(id) ON DELETE RESTRICT;

ALTER TABLE public.project_availability_bookings
    ADD COLUMN IF NOT EXISTS consultant_id uuid REFERENCES public.project_availability_consultants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS consultant_name text,
    ADD COLUMN IF NOT EXISTS consultant_email text;

CREATE INDEX IF NOT EXISTS idx_project_availability_slots_consultant
    ON public.project_availability_slots(project_id, consultant_id, slot_date, start_time)
    WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_project_availability_bookings_consultant
    ON public.project_availability_bookings(project_id, consultant_email, status);

WITH first_consultant AS (
    SELECT
        s.id AS slot_id,
        c.id AS consultant_id,
        row_number() OVER (
            PARTITION BY s.id
            ORDER BY c.sort_order, c.created_at, c.id
        ) AS rn
    FROM public.project_availability_slots s
    JOIN public.project_availability_consultants c
      ON c.project_id = s.project_id
     AND c.field_id = s.field_id
     AND c.is_active IS TRUE
    WHERE s.consultant_id IS NULL
      AND s.field_id IS NOT NULL
)
UPDATE public.project_availability_slots s
   SET consultant_id = first_consultant.consultant_id,
       updated_at = now()
  FROM first_consultant
 WHERE first_consultant.slot_id = s.id
   AND first_consultant.rn = 1;

UPDATE public.project_availability_bookings b
   SET consultant_id = s.consultant_id,
       consultant_name = COALESCE(NULLIF(c.name, ''), c.email),
       consultant_email = lower(c.email),
       updated_at = now()
  FROM public.project_availability_slots s
  LEFT JOIN public.project_availability_consultants c
    ON c.id = s.consultant_id
 WHERE b.slot_id = s.id
   AND b.consultant_id IS NULL
   AND s.consultant_id IS NOT NULL;

ALTER TABLE public.project_availability_slots
    DROP CONSTRAINT IF EXISTS project_availability_slots_project_field_date_start_key;

ALTER TABLE public.project_availability_slots
    DROP CONSTRAINT IF EXISTS project_availability_slots_project_field_consultant_date_start_key;

ALTER TABLE public.project_availability_slots
    ADD CONSTRAINT project_availability_slots_project_field_consultant_date_start_key
    UNIQUE (project_id, field_id, consultant_id, slot_date, start_time);

DROP FUNCTION IF EXISTS public.raise_if_availability_slot_consultant_conflict(uuid, uuid, uuid, date, time, time, text);

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
        f.label AS field_label,
        s.slot_date,
        s.start_time,
        s.end_time
      INTO v_conflict_label, v_conflict_date, v_conflict_start, v_conflict_end
      FROM public.project_availability_slots s
      JOIN public.project_availability_consultants c
        ON c.id = s.consultant_id
       AND c.is_active IS TRUE
       AND lower(c.email) = v_consultant_email
      LEFT JOIN public.fields f
        ON f.id = s.field_id
     WHERE s.project_id = p_project_id
       AND s.is_active IS TRUE
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
        RAISE EXCEPTION 'Consultant % already has an overlapping slot in % on % %-%',
            v_consultant_email,
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
            NEW.consultant_id,
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
BEFORE INSERT OR UPDATE OF field_id, consultant_id, slot_date, start_time, end_time, timezone, is_active
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

    SELECT other_slot.slot_date, other_slot.start_time, other_slot.end_time, f.label AS field_label
      INTO v_conflict_date, v_conflict_start, v_conflict_end, v_conflict_label
      FROM public.project_availability_slots s
      JOIN public.project_availability_slots other_slot
        ON other_slot.project_id = s.project_id
       AND other_slot.is_active IS TRUE
       AND other_slot.id <> s.id
      JOIN public.project_availability_consultants other_consultant
        ON other_consultant.id = other_slot.consultant_id
       AND other_consultant.is_active IS TRUE
       AND lower(other_consultant.email) = lower(NEW.email)
      LEFT JOIN public.fields f
        ON f.id = other_slot.field_id
     WHERE s.project_id = NEW.project_id
       AND s.consultant_id = NEW.id
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
DECLARE
    v_item jsonb;
    v_email text;
    v_name text;
    v_sort_order integer := 0;
    v_existing_id uuid;
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

    UPDATE public.project_availability_consultants c
       SET is_active = false,
           updated_at = now()
     WHERE c.project_id = p_project_id
       AND c.field_id = p_field_id
       AND lower(c.email) NOT IN (
            SELECT lower(trim(item.value->>'email'))
            FROM jsonb_array_elements(COALESCE(p_consultants, '[]'::jsonb)) AS item(value)
            WHERE trim(COALESCE(item.value->>'email', '')) <> ''
       );

    FOR v_item IN
        SELECT item.value
        FROM jsonb_array_elements(COALESCE(p_consultants, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
        WHERE trim(COALESCE(item.value->>'email', '')) <> ''
        ORDER BY item.ordinality
    LOOP
        v_email := lower(trim(v_item->>'email'));
        v_name := COALESCE(NULLIF(trim(v_item->>'name'), ''), v_email);

        SELECT c.id
          INTO v_existing_id
          FROM public.project_availability_consultants c
         WHERE c.project_id = p_project_id
           AND c.field_id = p_field_id
           AND lower(c.email) = v_email
         ORDER BY c.is_active DESC, c.created_at, c.id
         LIMIT 1;

        IF v_existing_id IS NULL THEN
            INSERT INTO public.project_availability_consultants (
                project_id,
                field_id,
                name,
                email,
                is_active,
                sort_order,
                updated_at
            )
            VALUES (
                p_project_id,
                p_field_id,
                v_name,
                v_email,
                true,
                v_sort_order,
                now()
            );
        ELSE
            UPDATE public.project_availability_consultants c
               SET name = v_name,
                   email = v_email,
                   is_active = true,
                   sort_order = v_sort_order,
                   updated_at = now()
             WHERE c.id = v_existing_id;

            UPDATE public.project_availability_consultants c
               SET is_active = false,
                   updated_at = now()
             WHERE c.project_id = p_project_id
               AND c.field_id = p_field_id
               AND lower(c.email) = v_email
               AND c.id <> v_existing_id;
        END IF;

        v_sort_order := v_sort_order + 1;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_project_availability_consultants(uuid, uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.get_project_availability_slots(uuid);

CREATE OR REPLACE FUNCTION public.get_project_availability_slots(p_project_id uuid)
RETURNS TABLE (
    id uuid,
    project_id uuid,
    field_id uuid,
    consultant_id uuid,
    consultant_name text,
    consultant_email text,
    consultant_sort_order integer,
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
        c.id AS consultant_id,
        COALESCE(NULLIF(c.name, ''), c.email) AS consultant_name,
        lower(c.email) AS consultant_email,
        c.sort_order AS consultant_sort_order,
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
    JOIN public.project_availability_consultants c
      ON c.id = s.consultant_id
     AND c.is_active IS TRUE
    JOIN public.project_availability_step_settings st
      ON st.project_id = s.project_id
     AND st.field_id = s.field_id
     AND st.is_enabled IS TRUE
    WHERE s.project_id = p_project_id
      AND s.field_id IS NOT NULL
      AND s.is_active IS TRUE
    ORDER BY s.field_id, s.slot_date, s.start_time, c.sort_order, c.name, c.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_availability_slots(uuid) TO authenticated;

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
                JOIN public.project_availability_slots booked_slot
                  ON booked_slot.id = b.slot_id
                JOIN public.project_availability_consultants booked_consultant
                  ON booked_consultant.id = booked_slot.consultant_id
                WHERE b.project_id = v_project_id
                  AND b.status = 'booked'
                  AND lower(booked_consultant.email) = cs.consultant_email
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
            JOIN public.project_availability_consultants booked_consultant
              ON booked_consultant.id = booked_slot.consultant_id
             AND booked_consultant.is_active IS TRUE
             AND lower(booked_consultant.email) = v_candidate.consultant_email
            WHERE b.project_id = v_project_id
              AND b.status = 'booked'
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
BEGIN
    RETURN public.book_project_availability_slot_v2(
        p_record_id,
        p_field_id,
        p_slot_id,
        ARRAY[p_slot_id]
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_project_availability_slot(uuid, uuid, uuid) TO authenticated;
