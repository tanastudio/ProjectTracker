-- Remove the temporary service-role diagnostic RPC used during auth trigger debugging.
DROP FUNCTION IF EXISTS public.debug_auth_user_create_dependencies();
