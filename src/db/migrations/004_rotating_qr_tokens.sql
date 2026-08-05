-- ============================================================================
-- 004_rotating_qr_tokens.sql
-- Rotating, single-use, short-lived QR tokens (POST /qr/token), separate
-- from customers.qr_token (the older static token, still used as a manual
-- fallback lookup in /api/loyalty/scan).
--
-- Why a separate table instead of reusing customers.qr_token: the whole
-- point of rotation is that a screenshotted or shoulder-surfed QR code
-- stops working after a few minutes. That only works if issuing a new
-- token doesn't require mutating the customer's permanent identity - this
-- table is purely ephemeral session data, cheap to expire/invalidate/prune
-- without touching the customers table at all.
-- ============================================================================

CREATE TABLE qr_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ,          -- set on the first successful /loyalty/scan, or when superseded by a newer token
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /loyalty/scan looks up "an unused, unexpired token matching this string" -
-- the UNIQUE constraint above already makes token lookups fast; this index
-- speeds up "find this customer's currently active token" when issuing a
-- new one (so the previous one can be invalidated).
CREATE INDEX idx_qr_tokens_customer_active
    ON qr_tokens (customer_id, created_at DESC)
    WHERE used_at IS NULL;