-- Remove legacy candidate profile triggers left behind on deployed databases.
--
-- These triggers reference candidate_record_id, which no longer exists after the
-- participant rename. They can break profile inserts fired from auth.users
-- provisioning and surface as "Database error creating new user".

DROP TRIGGER IF EXISTS t_link_candidate_by_email ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_candidate_display_name ON public.profiles;

DROP FUNCTION IF EXISTS public.link_candidate_by_email();
DROP FUNCTION IF EXISTS public.sync_candidate_display_name();
