-- Store the auth email on profiles for admin/member screens.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email text;

UPDATE public.profiles AS p
SET email = lower(u.email)
FROM auth.users AS u
WHERE p.id = u.id
  AND u.email IS NOT NULL
  AND (p.email IS NULL OR p.email = '');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique
    ON public.profiles (lower(email))
    WHERE email IS NOT NULL AND email <> '';
