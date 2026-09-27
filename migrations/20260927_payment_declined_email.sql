-- R12G: allow the authoritative declined-payment transactional email event.
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_eventtype_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_eventtype_check
  CHECK (eventtype IN ('order_received', 'order_shipped', 'order_delivered', 'payment_approved', 'payment_declined'));
