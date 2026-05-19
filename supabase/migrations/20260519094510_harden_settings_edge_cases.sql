ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS force_password_reset boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.force_password_reset IS
    'When true, the user must set a new password after signing in.';

ALTER TABLE public.fields
    DROP CONSTRAINT IF EXISTS fields_key_safe_identifier;

ALTER TABLE public.fields
    ADD CONSTRAINT fields_key_safe_identifier
    CHECK (
        key ~ '^[a-z][a-z0-9_]{0,59}$'
        AND lower(key) NOT IN (
            'id',
            'uuid',
            'project_id',
            'record_id',
            'field_id',
            'user_id',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
            'deleted_at',
            'code',
            'title',
            'active',
            'role',
            'value',
            'value_text',
            'value_select',
            'constructor',
            'prototype',
            '__proto__',
            'to_string',
            'has_own_property'
        )
        AND (
            lower(key) NOT IN ('email', 'issue', 'decision', 'overall_status')
            OR lower(key) = COALESCE(field_role, '')
        )
    ) NOT VALID;
