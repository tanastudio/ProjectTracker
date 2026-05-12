-- Track post-session completion status separately from booking status.

ALTER TABLE public.project_availability_bookings
    ADD COLUMN IF NOT EXISTS session_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS session_comment text,
    ADD COLUMN IF NOT EXISTS session_status_submitted_at timestamptz,
    ADD COLUMN IF NOT EXISTS session_status_submitted_by_email text,
    ADD COLUMN IF NOT EXISTS session_followup_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS session_followup_error text,
    ADD COLUMN IF NOT EXISTS session_followup_token_hash text,
    ADD COLUMN IF NOT EXISTS session_followup_token_expires_at timestamptz;

ALTER TABLE public.project_availability_bookings
    DROP CONSTRAINT IF EXISTS project_availability_bookings_session_status_check;

ALTER TABLE public.project_availability_bookings
    ADD CONSTRAINT project_availability_bookings_session_status_check
    CHECK (session_status IN ('pending', 'completed', 'not_completed'));

CREATE INDEX IF NOT EXISTS idx_project_availability_bookings_session_followup_due
    ON public.project_availability_bookings(status, session_status, session_followup_sent_at, project_id)
    WHERE status = 'booked' AND session_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_project_availability_bookings_session_token
    ON public.project_availability_bookings(session_followup_token_hash)
    WHERE session_followup_token_hash IS NOT NULL;

COMMENT ON COLUMN public.project_availability_bookings.session_status IS
    'Post-session consultant confirmation status. This is separate from booking status.';

CREATE OR REPLACE FUNCTION public.trg_reset_booking_session_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.session_status := COALESCE(NEW.session_status, 'pending');
        RETURN NEW;
    END IF;

    IF NEW.status = 'booked'
       AND (
            OLD.status IS DISTINCT FROM NEW.status
            OR OLD.slot_id IS DISTINCT FROM NEW.slot_id
            OR OLD.consultant_id IS DISTINCT FROM NEW.consultant_id
            OR OLD.booked_at IS DISTINCT FROM NEW.booked_at
       ) THEN
        NEW.session_status := 'pending';
        NEW.session_comment := NULL;
        NEW.session_status_submitted_at := NULL;
        NEW.session_status_submitted_by_email := NULL;
        NEW.session_followup_sent_at := NULL;
        NEW.session_followup_error := NULL;
        NEW.session_followup_token_hash := NULL;
        NEW.session_followup_token_expires_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_booking_session_state ON public.project_availability_bookings;
CREATE TRIGGER trg_reset_booking_session_state
BEFORE INSERT OR UPDATE OF status, slot_id, consultant_id, booked_at
ON public.project_availability_bookings
FOR EACH ROW
EXECUTE FUNCTION public.trg_reset_booking_session_state();

DO $$
DECLARE
    existing_job record;
BEGIN
    IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'Skipping booking session follow-up cron install because cron/vault is unavailable.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
    ) THEN
        PERFORM vault.create_secret(
            'https://vusgsdcozkaumyudqhlu.supabase.co',
            'project_url'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret'
    ) THEN
        PERFORM vault.create_secret(
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'project_update_cron_secret'
        );
    END IF;

    FOR existing_job IN
        SELECT jobid
        FROM cron.job
        WHERE jobname = 'booking-session-followup-minute'
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'booking-session-followup-minute',
        '*/5 * * * *',
        $cron$
        SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/booking-notify',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-project-update-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret')
            ),
            body := jsonb_build_object('action', 'send_session_followups', 'source', 'cron')
        );
        $cron$
    );
EXCEPTION
    WHEN undefined_function OR invalid_schema_name OR undefined_table THEN
        RAISE NOTICE 'Skipping booking session follow-up cron install because required extension objects are unavailable: %', SQLERRM;
END $$;
