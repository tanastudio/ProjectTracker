-- Mark existing booking-like select fields with an explicit booking role.
UPDATE public.fields
   SET field_role = 'booking'
 WHERE type = 'select'
   AND COALESCE(field_role, 'step') = 'step'
   AND (
        lower(COALESCE(key, '')) LIKE '%booking%'
        OR lower(COALESCE(key, '')) LIKE '%schedule%'
        OR lower(COALESCE(label, '')) LIKE '%booking%'
        OR lower(COALESCE(label, '')) LIKE '%schedule%'
   );

COMMENT ON COLUMN public.fields.field_role IS
  'Field behavior role: email, issue, decision, overall_status, step, booking.';
