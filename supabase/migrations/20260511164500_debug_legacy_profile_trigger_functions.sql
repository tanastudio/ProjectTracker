-- Extend temporary diagnostics with trigger function definitions.

CREATE OR REPLACE FUNCTION public.debug_auth_user_create_dependencies()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'auth_user_triggers',
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', t.tgname,
                'enabled', t.tgenabled,
                'function', n.nspname || '.' || p.proname,
                'definition', pg_get_triggerdef(t.oid),
                'function_definition', pg_get_functiondef(p.oid)
            ) ORDER BY t.tgname)
            FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE t.tgrelid = 'auth.users'::regclass
              AND NOT t.tgisinternal
        ), '[]'::jsonb),
        'profile_triggers',
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', t.tgname,
                'enabled', t.tgenabled,
                'function', n.nspname || '.' || p.proname,
                'definition', pg_get_triggerdef(t.oid),
                'function_definition', pg_get_functiondef(p.oid)
            ) ORDER BY t.tgname)
            FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE t.tgrelid = 'public.profiles'::regclass
              AND NOT t.tgisinternal
        ), '[]'::jsonb),
        'profile_constraints',
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', conname,
                'definition', pg_get_constraintdef(oid)
            ) ORDER BY conname)
            FROM pg_constraint
            WHERE conrelid = 'public.profiles'::regclass
        ), '[]'::jsonb)
    );
$$;

REVOKE ALL ON FUNCTION public.debug_auth_user_create_dependencies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debug_auth_user_create_dependencies() FROM anon;
REVOKE ALL ON FUNCTION public.debug_auth_user_create_dependencies() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.debug_auth_user_create_dependencies() TO service_role;
