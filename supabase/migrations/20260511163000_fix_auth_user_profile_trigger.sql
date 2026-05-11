-- Harden legacy auth-user profile provisioning for deployed databases.
--
-- Older remote databases can still have an auth.users trigger that calls
-- public.handle_new_user(). The old implementation defaulted missing roles to
-- "external", which violates the current profiles_role_check constraint and
-- makes Supabase Auth return "Database error creating new user".

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles
SET role = 'viewer'
WHERE role IS NULL
   OR role NOT IN ('admin', 'internal', 'client', 'participant', 'viewer');

ALTER TABLE public.profiles
    ALTER COLUMN role SET DEFAULT 'viewer';

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'internal', 'client', 'participant', 'viewer'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    v_role := lower(nullif(trim(NEW.raw_user_meta_data ->> 'role'), ''));
    IF v_role NOT IN ('admin', 'internal', 'client', 'participant', 'viewer') THEN
        v_role := 'viewer';
    END IF;

    INSERT INTO public.profiles (id, display_name, email, role)
    VALUES (
        NEW.id,
        NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''),
        NEW.email,
        v_role
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
        role = CASE
            WHEN public.profiles.role IN ('admin', 'internal', 'client', 'participant', 'viewer')
                THEN public.profiles.role
            ELSE EXCLUDED.role
        END;

    RETURN NEW;
END;
$$;
