-- ============================================================================
-- 003_phone_verification.sql
-- Temporary storage for dev SMS verification codes (POST /auth/send-code,
-- POST /auth/verify-code). No Twilio integration yet - codes are printed
-- to the server console for local testing.
--
-- Rows are marked consumed rather than deleted on successful verification,
-- matching the append-only/audit-friendly pattern used elsewhere in this
-- schema (loyalty_ledger, redemptions) rather than hard-deleting history.
-- ============================================================================

CREATE TABLE phone_verification_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         TEXT NOT NULL,       -- normalized E.164, see src/utils/phone.js
    code          TEXT NOT NULL,       -- 6-digit numeric string
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,          -- NULL until successfully verified
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verify-code always looks up "the most recent unconsumed code for this
-- phone" - this index makes that lookup fast.
CREATE INDEX idx_verification_codes_phone_recent
    ON phone_verification_codes (phone, created_at DESC)
    WHERE consumed_at IS NULL;