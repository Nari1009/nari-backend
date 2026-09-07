-- NARI - bounded review-request retries
-- Additive only. Existing request state, eligibility and tokens are preserved.
ALTER TABLE public.order_review_requests
  ADD COLUMN IF NOT EXISTS nextattemptat TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS order_review_requests_retry_idx
  ON public.order_review_requests (status, eligibleat, nextattemptat);
