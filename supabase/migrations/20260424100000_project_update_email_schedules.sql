-- Scheduled client-facing project update emails.

CREATE TABLE IF NOT EXISTS public.project_update_email_settings (
    project_id                 uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
    is_enabled                 boolean     NOT NULL DEFAULT false,
    schedule_type              text        NOT NULL DEFAULT 'weekly',
    weekly_days                smallint[]  NOT NULL DEFAULT ARRAY[1]::smallint[],
    monthly_days               smallint[]  NOT NULL DEFAULT ARRAY[]::smallint[],
    monthly_mode               text        NOT NULL DEFAULT 'dates',
    cc_emails                  text[]      NOT NULL DEFAULT ARRAY[]::text[],
    bcc_emails                 text[]      NOT NULL DEFAULT ARRAY[]::text[],
    internal_is_enabled        boolean     NOT NULL DEFAULT false,
    internal_schedule_type     text        NOT NULL DEFAULT 'weekly',
    internal_weekly_days       smallint[]  NOT NULL DEFAULT ARRAY[5]::smallint[],
    internal_monthly_days      smallint[]  NOT NULL DEFAULT ARRAY[]::smallint[],
    internal_monthly_mode      text        NOT NULL DEFAULT 'end_of_month',
    send_hour                  smallint    NOT NULL DEFAULT 9,
    timezone                   text        NOT NULL DEFAULT 'Asia/Bangkok',
    last_sent_at               timestamptz,
    last_internal_sent_at      timestamptz,
    created_by                 uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by                 uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_update_email_settings_schedule_type_check
        CHECK (schedule_type IN ('weekly', 'monthly')),
    CONSTRAINT project_update_email_settings_monthly_mode_check
        CHECK (monthly_mode IN ('dates', 'end_of_month')),
    CONSTRAINT project_update_email_settings_internal_schedule_type_check
        CHECK (internal_schedule_type IN ('weekly', 'monthly')),
    CONSTRAINT project_update_email_settings_internal_monthly_mode_check
        CHECK (internal_monthly_mode IN ('dates', 'end_of_month')),
    CONSTRAINT project_update_email_settings_send_hour_check
        CHECK (send_hour BETWEEN 0 AND 23),
    CONSTRAINT project_update_email_settings_weekly_values_check
        CHECK (weekly_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    CONSTRAINT project_update_email_settings_internal_weekly_values_check
        CHECK (internal_weekly_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    CONSTRAINT project_update_email_settings_monthly_values_check
        CHECK (monthly_days <@ ARRAY[
            1,2,3,4,5,6,7,8,9,10,
            11,12,13,14,15,16,17,18,19,20,
            21,22,23,24,25,26,27,28,29,30,31
        ]::smallint[]),
    CONSTRAINT project_update_email_settings_internal_monthly_values_check
        CHECK (internal_monthly_days <@ ARRAY[
            1,2,3,4,5,6,7,8,9,10,
            11,12,13,14,15,16,17,18,19,20,
            21,22,23,24,25,26,27,28,29,30,31
        ]::smallint[]),
    CONSTRAINT project_update_email_settings_schedule_payload_check
        CHECK (
            (schedule_type = 'weekly'  AND cardinality(weekly_days) BETWEEN 1 AND 7 AND cardinality(monthly_days) = 0)
            OR
            (
                schedule_type = 'monthly'
                AND cardinality(weekly_days) = 0
                AND (
                    (monthly_mode = 'dates' AND cardinality(monthly_days) BETWEEN 1 AND 2)
                    OR
                    (monthly_mode = 'end_of_month' AND cardinality(monthly_days) = 0)
                )
            )
        ),
    CONSTRAINT project_update_email_settings_internal_schedule_payload_check
        CHECK (
            (
                internal_schedule_type = 'weekly'
                AND cardinality(internal_weekly_days) BETWEEN 1 AND 7
                AND cardinality(internal_monthly_days) = 0
            )
            OR
            (
                internal_schedule_type = 'monthly'
                AND cardinality(internal_weekly_days) = 0
                AND (
                    (internal_monthly_mode = 'dates' AND cardinality(internal_monthly_days) BETWEEN 1 AND 2)
                    OR
                    (internal_monthly_mode = 'end_of_month' AND cardinality(internal_monthly_days) = 0)
                )
            )
        )
);

CREATE TABLE IF NOT EXISTS public.project_update_email_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    recipient_group text        NOT NULL DEFAULT 'client',
    trigger_source  text        NOT NULL,
    local_send_date date,
    status          text        NOT NULL DEFAULT 'queued',
    recipients      text[]      NOT NULL DEFAULT ARRAY[]::text[],
    cc_emails       text[]      NOT NULL DEFAULT ARRAY[]::text[],
    bcc_emails      text[]      NOT NULL DEFAULT ARRAY[]::text[],
    summary         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key      text UNIQUE,
    error_message   text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_update_email_runs_recipient_group_check
        CHECK (recipient_group IN ('client', 'internal')),
    CONSTRAINT project_update_email_runs_trigger_source_check
        CHECK (trigger_source IN ('scheduled', 'manual')),
    CONSTRAINT project_update_email_runs_status_check
        CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))
);

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()),
        'viewer'
    );
$$;

CREATE OR REPLACE FUNCTION public.current_candidate_record_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.candidate_record_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_profile_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.projects p
        WHERE p.id = p_project_id
          AND p.created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.project_id = p_project_id
          AND pm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.is_project_creator(p_project_id)
        OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            WHERE pm.project_id = p_project_id
              AND pm.user_id = auth.uid()
              AND pm.role IN ('admin', 'editor')
        );
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR public.is_project_member(p_project_id)
        OR public.is_project_creator(p_project_id)
        OR EXISTS (
            SELECT 1
            FROM public.records r
            WHERE r.project_id = p_project_id
              AND r.id = public.current_candidate_record_id()
        );
$$;

ALTER TABLE public.project_update_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_update_email_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_update_email_settings_select ON public.project_update_email_settings;
CREATE POLICY project_update_email_settings_select ON public.project_update_email_settings
FOR SELECT TO authenticated
USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS project_update_email_settings_insert ON public.project_update_email_settings;
CREATE POLICY project_update_email_settings_insert ON public.project_update_email_settings
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_project(project_id));

DROP POLICY IF EXISTS project_update_email_settings_update ON public.project_update_email_settings;
CREATE POLICY project_update_email_settings_update ON public.project_update_email_settings
FOR UPDATE TO authenticated
USING (public.can_edit_project(project_id))
WITH CHECK (public.can_edit_project(project_id));

DROP POLICY IF EXISTS project_update_email_settings_delete ON public.project_update_email_settings;
CREATE POLICY project_update_email_settings_delete ON public.project_update_email_settings
FOR DELETE TO authenticated
USING (public.can_edit_project(project_id));

DROP POLICY IF EXISTS project_update_email_runs_select ON public.project_update_email_runs;
CREATE POLICY project_update_email_runs_select ON public.project_update_email_runs
FOR SELECT TO authenticated
USING (public.can_edit_project(project_id));

INSERT INTO public.project_update_email_settings (project_id, created_by, updated_by)
SELECT p.id, p.created_by, p.created_by
FROM public.projects p
WHERE NOT EXISTS (
    SELECT 1
    FROM public.project_update_email_settings s
    WHERE s.project_id = p.id
);

DO $$
DECLARE
    existing_job record;
BEGIN
    IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'Skipping project update email cron bootstrap because cron/vault is unavailable.';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url'
    ) OR NOT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_update_cron_secret'
    ) THEN
        RAISE NOTICE 'Skipping project update email cron bootstrap because Vault secrets project_url/project_update_cron_secret are missing.';
        RETURN;
    END IF;

    FOR existing_job IN
        SELECT jobid
        FROM cron.job
        WHERE jobname = 'project-update-summary-hourly'
    LOOP
        PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
        'project-update-summary-hourly',
        '5 * * * *',
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
        RAISE NOTICE 'Skipping project update email cron bootstrap because required extensions are unavailable.';
END $$;
