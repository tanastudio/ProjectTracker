CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_key text NOT NULL,
    recipient_email text NOT NULL,
    provider text,
    sent_at timestamptz,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_deliveries_key_email_unique UNIQUE (notification_key, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_key_sent
    ON public.notification_deliveries(notification_key, sent_at);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notification_deliveries IS
    'Tracks notification delivery by event and recipient so Edge Function retries do not resend to recipients already delivered.';
