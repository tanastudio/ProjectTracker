-- ============================================================
-- Audit logs for user actions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid,
    actor_email   text,
    actor_role    text,
    action        text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    table_name    text        NOT NULL,
    entity_id     text,
    project_id    uuid,
    summary       text,
    changed_fields jsonb      NOT NULL DEFAULT '{}'::jsonb,
    old_data      jsonb,
    new_data      jsonb,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at
    ON public.audit_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id
    ON public.audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id
    ON public.audit_logs (project_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_action
    ON public.audit_logs (table_name, action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete ON public.audit_logs;

CREATE POLICY audit_logs_select ON public.audit_logs
FOR SELECT TO authenticated
USING (public.is_admin());

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_jwt_claim(p_claim text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_claims jsonb;
BEGIN
    BEGIN
        v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;

    RETURN v_claims ->> p_claim;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_changed_fields(p_old jsonb, p_new jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        jsonb_object_agg(
            n.key,
            jsonb_build_object('old', o.value, 'new', n.value)
            ORDER BY n.key
        ),
        '{}'::jsonb
    )
    FROM jsonb_each(p_new) AS n
    JOIN jsonb_each(p_old) AS o USING (key)
    WHERE n.value IS DISTINCT FROM o.value
      AND n.key <> 'updated_at';
$$;

CREATE OR REPLACE FUNCTION public.audit_entity_id(p_table_name text, p_row jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
    IF p_row IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_row ? 'id' THEN
        RETURN p_row ->> 'id';
    END IF;

    IF p_table_name = 'project_members' THEN
        RETURN concat_ws(':', p_row ->> 'user_id', p_row ->> 'project_id');
    END IF;

    IF p_table_name = 'client_record_assignments' THEN
        RETURN concat_ws(':', p_row ->> 'client_user_id', p_row ->> 'record_id');
    END IF;

    IF p_table_name = 'ticket_read_states' THEN
        RETURN concat_ws(':', p_row ->> 'user_id', p_row ->> 'ticket_id');
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_project_id(p_table_name text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_id uuid;
BEGIN
    IF p_row IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_table_name = 'projects' AND p_row ? 'id' THEN
        RETURN NULLIF(p_row ->> 'id', '')::uuid;
    END IF;

    IF p_row ? 'project_id' THEN
        RETURN NULLIF(p_row ->> 'project_id', '')::uuid;
    END IF;

    IF p_table_name = 'record_values' AND p_row ? 'record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'ticket_replies' AND p_row ? 'ticket_id' THEN
        SELECT q.project_id INTO v_project_id
        FROM public.requests q
        WHERE q.id = NULLIF(p_row ->> 'ticket_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'ticket_read_states' AND p_row ? 'ticket_id' THEN
        SELECT q.project_id INTO v_project_id
        FROM public.requests q
        WHERE q.id = NULLIF(p_row ->> 'ticket_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'client_record_assignments' AND p_row ? 'record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    IF p_table_name = 'profiles' AND p_row ? 'participant_record_id' THEN
        SELECT r.project_id INTO v_project_id
        FROM public.records r
        WHERE r.id = NULLIF(p_row ->> 'participant_record_id', '')::uuid;
        RETURN v_project_id;
    END IF;

    RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
    v_row jsonb := COALESCE(v_new, v_old);
    v_changed jsonb := '{}'::jsonb;
    v_changed_names text;
    v_entity_id text;
    v_actor_role text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_changed := public.audit_changed_fields(v_old, v_new);

        IF v_changed = '{}'::jsonb THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT string_agg(k, ', ' ORDER BY k)
      INTO v_changed_names
    FROM jsonb_object_keys(v_changed) AS k;

    v_entity_id := public.audit_entity_id(TG_TABLE_NAME, v_row);
    v_actor_role := public.current_profile_role();

    INSERT INTO public.audit_logs (
        actor_user_id,
        actor_email,
        actor_role,
        action,
        table_name,
        entity_id,
        project_id,
        summary,
        changed_fields,
        old_data,
        new_data
    )
    VALUES (
        auth.uid(),
        public.audit_jwt_claim('email'),
        v_actor_role,
        TG_OP,
        TG_TABLE_NAME,
        v_entity_id,
        public.audit_project_id(TG_TABLE_NAME, v_row),
        CASE
            WHEN TG_OP = 'UPDATE' AND v_changed_names IS NOT NULL
                THEN format('%s %s %s changed: %s', TG_OP, TG_TABLE_NAME, COALESCE(v_entity_id, ''), v_changed_names)
            ELSE format('%s %s %s', TG_OP, TG_TABLE_NAME, COALESCE(v_entity_id, ''))
        END,
        v_changed,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN v_old ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN v_new ELSE NULL END
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.install_audit_trigger(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS audit_log_change ON %s', p_table);
    EXECUTE format(
        'CREATE TRIGGER audit_log_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION public.audit_table_change()',
        p_table
    );
END;
$$;

SELECT public.install_audit_trigger('public.profiles'::regclass);
SELECT public.install_audit_trigger('public.projects'::regclass);
SELECT public.install_audit_trigger('public.project_members'::regclass);
SELECT public.install_audit_trigger('public.fields'::regclass);
SELECT public.install_audit_trigger('public.records'::regclass);
SELECT public.install_audit_trigger('public.record_values'::regclass);
SELECT public.install_audit_trigger('public.requests'::regclass);
SELECT public.install_audit_trigger('public.ticket_replies'::regclass);

DO $$
BEGIN
    IF to_regclass('public.client_record_assignments') IS NOT NULL THEN
        PERFORM public.install_audit_trigger('public.client_record_assignments'::regclass);
    END IF;

    IF to_regclass('public.ticket_read_states') IS NOT NULL THEN
        PERFORM public.install_audit_trigger('public.ticket_read_states'::regclass);
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.install_audit_trigger(regclass);
