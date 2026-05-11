-- Split field visibility by audience.
-- show_in_dashboard remains the client dashboard visibility flag.

ALTER TABLE public.fields
ADD COLUMN IF NOT EXISTS show_in_participant_status boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS show_in_internal boolean NOT NULL DEFAULT true;

-- Preserve previous behaviour:
-- Participant status had followed dashboard visibility, while internal update
-- status had followed is_active visibility.
UPDATE public.fields
SET show_in_participant_status = show_in_dashboard
WHERE show_in_participant_status IS DISTINCT FROM show_in_dashboard;

UPDATE public.fields
SET show_in_internal = is_active
WHERE show_in_internal IS DISTINCT FROM is_active;

-- Fields that were globally inactive should stay hidden everywhere after the
-- visibility split.
UPDATE public.fields
SET
  show_in_dashboard = false,
  show_in_participant_status = false,
  show_in_internal = false
WHERE is_active = false;
