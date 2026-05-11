-- Enable cron dependencies and install the minute-level project update job.

DO $$
BEGIN
    BEGIN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
    EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
        RAISE NOTICE 'Skipping pg_net extension enablement: %', SQLERRM;
    END;

    BEGIN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
    EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
        RAISE NOTICE 'Skipping pg_cron extension enablement: %', SQLERRM;
    END;

    BEGIN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE';
    EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
        RAISE NOTICE 'Skipping Vault extension enablement: %', SQLERRM;
    END;
END $$;

DO $$
DECLARE
    existing_job record;
BEGIN
    IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'Skipping project update email cron install because cron/vault is unavailable.';
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
        RAISE NOTICE 'Skipping project update email cron install because required extension objects are unavailable: %', SQLERRM;
END $$;
