-- ============================================================================
-- 002_punch_card_model.sql
-- Replaces the dollar-proportional points model (points_per_dollar) with a
-- fixed punch-card model: a flat number of points per qualifying purchase,
-- and a flat point cost per reward redemption.
--
-- V0 note: points_per_visit and reward_threshold are kept as PER-BUSINESS
-- columns (not global constants) even though V0 hardcodes every business to
-- the same values (7 and 21) at application level. This is deliberate -
-- it means V1 can make these genuinely configurable per business later by
-- just changing what the app writes/reads here, with no further migration
-- needed. There is intentionally no endpoint yet that lets a business change
-- these values - see src/routes/loyalty.js for where the V0 constants live.
--
-- "Qualifying purchase" itself (minimum $ amount, item count, etc. - which
-- may differ per business) is also V1 scope. For V0, any completed POS
-- transaction found by the claim endpoint's existing lookup counts as
-- qualifying.
-- ============================================================================

ALTER TABLE businesses
  DROP COLUMN points_per_dollar;

ALTER TABLE businesses
  ADD COLUMN points_per_visit INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN reward_threshold INTEGER NOT NULL DEFAULT 21;

COMMENT ON COLUMN businesses.points_per_visit IS
  'Points awarded per qualifying purchase. V0: every business uses the app-level default (7); not yet independently settable per business.';
COMMENT ON COLUMN businesses.reward_threshold IS
  'Points required to redeem one reward. V0: every business uses the app-level default (21); not yet independently settable per business.';