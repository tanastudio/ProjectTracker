-- Reinstall the project update summary cron job after runtime secrets are configured.

DO $$
DECLARE
    existing_job record;
BEGIN
    IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'Skipping project update email cron reinstall because cron/vault is unavailable.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
    ) THEN
        RAISE NOTICE 'Skipping project update email cron reinstall because Vault secret project_url is missing.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret'
    ) THEN
        PERFORM vault.create_secret(
            encode(gen_random_bytes(32), 'hex'),
            'project_update_cron_secret'
        );
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
        RAISE NOTICE 'Skipping project update email cron reinstall because required extensions are unavailable.';
END $$;
