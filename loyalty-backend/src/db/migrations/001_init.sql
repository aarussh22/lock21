-- ============================================================================
-- 001_init.sql
-- Core schema for the loyalty platform (business side).
-- Design goals:
--   1. One clear source of truth for "has this customer earned points at this
--      business in the last 24 hours" (loyalty_ledger + an index, not a
--      calendar-day constraint, since the rule is a rolling 24h window).
--   2. POS access tokens are stored encrypted (see services/crypto.js) -
--      the columns below hold ciphertext, never plaintext tokens.
--   3. Every table that money/points touches has enough audit fields to
--      reconstruct "who did what, when, from which purchase" after the fact.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gives us gen_random_uuid()

-- ----------------------------------------------------------------------------
-- BUSINESSES
-- One row per merchant location. If a business has multiple locations under
-- one Square account, give each location its own row (pos_location_id is
-- what actually scopes Square API calls, not the merchant id).
-- ----------------------------------------------------------------------------
CREATE TABLE businesses (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    address                 TEXT,
    city                    TEXT,
    province                TEXT,
    postal_code             TEXT,
    owner_email             TEXT NOT NULL UNIQUE,
    owner_password_hash     TEXT NOT NULL, -- bcrypt hash, business-owner login (dashboard)

    pos_provider            TEXT NOT NULL DEFAULT 'square'
                                CHECK (pos_provider IN ('square', 'clover', 'toast')),
    pos_merchant_id         TEXT,           -- Square merchant_id, set after OAuth
    pos_location_id         TEXT,           -- Square location_id, set after OAuth
    pos_access_token_enc    TEXT,           -- AES-256-GCM ciphertext, never plaintext
    pos_refresh_token_enc   TEXT,
    pos_token_expires_at    TIMESTAMPTZ,
    pos_connected_at        TIMESTAMPTZ,

    points_per_dollar       NUMERIC(6,2) NOT NULL DEFAULT 1.00, -- earn rate, tunable per business
    status                  TEXT NOT NULL DEFAULT 'pending_pos_connection'
                                CHECK (status IN ('pending_pos_connection', 'active', 'suspended')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- BUSINESS_DEVICES
-- The staff/terminal logins used at the counter to open the "claim points"
-- screen. Deliberately separate from the owner login above - a cashier
-- shouldn't have the credentials that can disconnect the POS or see payouts.
-- ----------------------------------------------------------------------------
CREATE TABLE business_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    device_label    TEXT NOT NULL,             -- e.g. "Front Counter iPad"
    pin_hash        TEXT NOT NULL,              -- bcrypt hash of a 4-6 digit staff PIN
    role            TEXT NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('staff', 'manager')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- CUSTOMERS
-- qr_token is what's actually encoded in the customer's QR code - NOT their
-- raw id. Keeping them separate means we can rotate qr_token (e.g. if a
-- customer's phone is lost) without changing their permanent identity/history.
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           TEXT NOT NULL UNIQUE,       -- E.164 format, e.g. +15195551234
    email           TEXT UNIQUE,
    first_name      TEXT,
    last_name       TEXT,
    qr_token        TEXT NOT NULL UNIQUE,       -- random opaque token, see utils/tokens.js
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TRANSACTIONS
-- A cached mirror of the relevant fields from a completed POS payment.
-- We store this even though Square is the "real" source of the sale, because:
--   (a) it lets us match a claim to a purchase without re-hitting the POS
--       API on every claim attempt, and
--   (b) it gives us an audit trail if a POS token is later revoked.
-- The UNIQUE constraint prevents the same POS payment from ever being
-- captured twice, even if a webhook fires more than once.
-- ----------------------------------------------------------------------------
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL, -- unknown until claimed
    pos_order_id        TEXT,
    pos_payment_id      TEXT NOT NULL,
    amount_cents        INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency            TEXT NOT NULL DEFAULT 'CAD',
    pos_status          TEXT NOT NULL DEFAULT 'COMPLETED',
    pos_created_at      TIMESTAMPTZ NOT NULL,     -- when Square says the sale happened
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(), -- when our webhook received it
    claimed_at          TIMESTAMPTZ,               -- null until a customer claims points on it
    UNIQUE (business_id, pos_payment_id)
);

CREATE INDEX idx_transactions_business_recent
    ON transactions (business_id, pos_created_at DESC);

CREATE INDEX idx_transactions_unclaimed
    ON transactions (business_id, claimed_at)
    WHERE claimed_at IS NULL;

-- ----------------------------------------------------------------------------
-- LOYALTY_LEDGER
-- The append-only record of every point award. This table (plus the index
-- below) IS the enforcement mechanism for "once per 24h per business."
-- We never UPDATE or DELETE rows here - corrections are new rows (negative
-- points_earned), same pattern as financial ledgers, so history is never lost.
-- ----------------------------------------------------------------------------
CREATE TABLE loyalty_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    points_earned       INTEGER NOT NULL,
    earned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key     TEXT NOT NULL UNIQUE, -- see loyalty.js claim endpoint
    device_id           UUID REFERENCES business_devices(id) ON DELETE SET NULL
);

-- This is the index the 24-hour rule check runs against. A claim attempt
-- does: SELECT 1 FROM loyalty_ledger WHERE customer_id = $1 AND business_id = $2
--       AND earned_at > now() - interval '24 hours' LIMIT 1
-- This composite index makes that lookup effectively instant even at scale.
CREATE INDEX idx_ledger_customer_business_time
    ON loyalty_ledger (customer_id, business_id, earned_at DESC);

-- ----------------------------------------------------------------------------
-- REDEMPTIONS
-- Points spent. Kept separate from loyalty_ledger (which is earn-only) so
-- "points earned" and "points redeemed" reports never need a WHERE clause
-- to distinguish direction - and so redemptions can carry their own fields
-- (like which reward was chosen) without polluting the earn ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE redemptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    points_used         INTEGER NOT NULL CHECK (points_used > 0),
    reward_description  TEXT NOT NULL,
    redeemed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id           UUID REFERENCES business_devices(id) ON DELETE SET NULL
);

CREATE INDEX idx_redemptions_customer ON redemptions (customer_id, redeemed_at DESC);

-- ----------------------------------------------------------------------------
-- Convenience view: current point balance per customer per business.
-- (Sum of earns minus sum of redemptions.) Cheap to compute at this scale;
-- worth materializing later once transaction volume is large.
-- ----------------------------------------------------------------------------
CREATE VIEW customer_balances AS
SELECT
    l.customer_id,
    l.business_id,
    COALESCE(SUM(l.points_earned), 0) AS points_earned_total,
    COALESCE((
        SELECT SUM(r.points_used) FROM redemptions r
        WHERE r.customer_id = l.customer_id AND r.business_id = l.business_id
    ), 0) AS points_redeemed_total,
    COALESCE(SUM(l.points_earned), 0) - COALESCE((
        SELECT SUM(r.points_used) FROM redemptions r
        WHERE r.customer_id = l.customer_id AND r.business_id = l.business_id
    ), 0) AS points_balance
FROM loyalty_ledger l
GROUP BY l.customer_id, l.business_id;
