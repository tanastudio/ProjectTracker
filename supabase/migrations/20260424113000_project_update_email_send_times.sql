-- Add minute-level send times and separate internal delivery times.

ALTER TABLE public.project_update_email_settings
    ADD COLUMN IF NOT EXISTS send_minute smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS internal_send_hour smallint NOT NULL DEFAULT 9,
    ADD COLUMN IF NOT EXISTS internal_send_minute smallint NOT NULL DEFAULT 0;

UPDATE public.project_update_email_settings
SET internal_send_hour = COALESCE(internal_send_hour, send_hour, 9),
    internal_send_minute = COALESCE(internal_send_minute, send_minute, 0),
    send_minute = COALESCE(send_minute, 0)
WHERE true;

ALTER TABLE public.project_update_email_settings
    DROP CONSTRAINT IF EXISTS project_update_email_settings_send_minute_check,
    DROP CONSTRAINT IF EXISTS project_update_email_settings_internal_send_hour_check,
    DROP CONSTRAINT IF EXISTS project_update_email_settings_internal_send_minute_check;

ALTER TABLE public.project_update_email_settings
    ADD CONSTRAINT project_update_email_settings_send_minute_check
        CHECK (send_minute BETWEEN 0 AND 59),
    ADD CONSTRAINT project_update_email_settings_internal_send_hour_check
        CHECK (internal_send_hour BETWEEN 0 AND 23),
    ADD CONSTRAINT project_update_email_settings_internal_send_minute_check
        CHECK (internal_send_minute BETWEEN 0 AND 59);

DO $$
DECLARE
    existing_job record;
BEGIN
    IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'Skipping project update email cron upgrade because cron/vault is unavailable.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
    ) OR NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret'
    ) THEN
        RAISE NOTICE 'Skipping project update email cron upgrade because Vault secrets project_url/project_update_cron_secret are missing.';
        RETURN;
    END IF;

    FOR existing_job IN
        SELECT jobid
        FROM cron.job
        WHERE jobname IN ('project-update-summary-hourly', 'project-update-summary-minute')
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'project-update-summary-minute',
        '* * * * *',
        $cron$
        SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/project-update-summary',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-project-update-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret')
            ),
            body := jsonb_build_object('source', 'cron')
        );
        $cron$
    );
EXCEPTION
    WHEN undefined_function OR invalid_schema_name OR undefined_table THEN
        RAISE NOTICE 'Skipping project update email cron upgrade because required extensions are unavailable.';
END $$;
