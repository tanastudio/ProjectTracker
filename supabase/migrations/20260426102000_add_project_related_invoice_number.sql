-- Store an optional invoice reference for each project.

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS related_invoice_number text;
