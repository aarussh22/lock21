import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireBusinessDevice } from '../middleware/auth.js';
import { claimIdempotencyKey } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import 'dotenv/config';

export const loyaltyRouter = Router();

const CLAIM_WINDOW_HOURS = Number(process.env.CLAIM_WINDOW_HOURS ?? 24);
// How far back we'll look for an unclaimed purchase when staff hits "claim" -
// this is NOT the 24h loyalty rule, it's a separate, much shorter window that
// answers "did this customer just buy something at this register." Keeps a
// customer from claiming points on a sale from three days ago that they
// forgot to scan for at the time.
const RECENT_PURCHASE_WINDOW_MINUTES = 30;

// --- Punch-card points model (V0) ---
// Every qualifying purchase awards a flat number of points; every reward
// redemption costs a flat number of points. Both numbers are read from the
// business's own row (businesses.points_per_visit / reward_threshold) rather
// than hardcoded here - every business currently defaults to 7 and 21 (see
// db/migrations/002_punch_card_model.sql), but reading from the row instead
// of a JS constant means V1 can make these genuinely configurable per
// business later with zero changes to this file.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/loyalty/scan
 * Business device sends either a scanned QR payload OR a manually-typed
 * phone number (satisfies requirement #5 - both entry modes hit this same
 * endpoint, the app just decides which field to fill in).
 * Body: { qrToken } OR { phone }
 *
 * qrToken lookup checks the ROTATING token table (qr_tokens, issued by
 * POST /qr/token) FIRST, since that's what the iOS app's QR screen
 * actually displays now. Falls back to the older static customers.qr_token
 * match for backward compatibility (e.g. manual curl testing against a
 * customer created before the rotating system existed, or a customer
 * record created directly rather than through /auth/verify-code).
 */
loyaltyRouter.post('/scan', requireBusinessDevice, asyncHandler(async (req, res) => {
  const { qrToken, phone } = req.body;
  if (!qrToken && !phone) {
    return res.status(400).json({ error: 'Provide either qrToken or phone' });
  }

  if (qrToken) {
    const { rows: rotatingRows } = await query(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.qr_token
       FROM qr_tokens t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.token = $1 AND t.used_at IS NULL AND t.expires_at > now()
       LIMIT 1`,
      [qrToken]
    );
    if (rotatingRows[0]) {
      // Mark this rotating token used - it's a single-use code, per spec.
      await query('UPDATE qr_tokens SET used_at = now() WHERE token = $1', [qrToken]);
      return res.json({ customer: rotatingRows[0] });
    }
    // Fall through to the static-token/phone lookup below - covers the
    // backward-compatibility case described above. If qrToken was set but
    // matches neither table, the query below correctly returns nothing.
  }


  const { rows } = await query(
    `SELECT id, first_name, last_name, phone, qr_token
     FROM customers
     WHERE qr_token = $1 OR phone = $2
     LIMIT 1`,
    [qrToken ?? null, phone ?? null]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: 'No customer found for that code or phone number' });
  }

  return res.json({ customer: rows[0] });
}));

/**
 * POST /api/loyalty/claim
 * The core rules engine. Body: { customerId }
 * Sequence:
 *   1. Find the most recent unclaimed, completed POS transaction at this
 *      business within RECENT_PURCHASE_WINDOW_MINUTES (proves "a purchase
 *      has been made" - requirement #3).
 *   2. Check the 24-hour rule: has this customer already earned points at
 *      THIS business within CLAIM_WINDOW_HOURS? (requirement #4 - scoped
 *      per business, so the same customer can still earn at a different
 *      store today).
 *   3. If both checks pass, atomically mark the transaction claimed and
 *      insert the ledger row, inside one DB transaction so a crash between
 *      the two steps can't happen.
 */
loyaltyRouter.post('/claim', requireBusinessDevice, asyncHandler(async (req, res) => {
  const { customerId } = req.body;
  const businessId = req.auth.businessId; // trust the authenticated device, not client input
  const deviceId = req.auth.deviceId;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }
  if (!UUID_RE.test(customerId)) {
    return res.status(400).json({ error: 'customerId is not a valid UUID - did you paste a real id, not a placeholder?' });
  }

  // --- Step 1: is there a purchase to claim against? ---
  const { rows: txRows } = await query(
    `SELECT id, amount_cents, currency, pos_created_at
     FROM transactions
     WHERE business_id = $1
       AND claimed_at IS NULL
       AND pos_status = 'COMPLETED'
       AND pos_created_at > now() - ($2 || ' minutes')::interval
     ORDER BY pos_created_at DESC
     LIMIT 1`,
    [businessId, RECENT_PURCHASE_WINDOW_MINUTES]
  );
  const transaction = txRows[0];

  if (!transaction) {
    return res.status(404).json({
      error: `No recent unclaimed purchase found at this location in the last ${RECENT_PURCHASE_WINDOW_MINUTES} minutes.`,
    });
  }

  // --- Step 2: 24-hour-per-business rule ---
  const { rows: recentClaims } = await query(
    `SELECT id FROM loyalty_ledger
     WHERE customer_id = $1 AND business_id = $2
       AND earned_at > now() - ($3 || ' hours')::interval
     LIMIT 1`,
    [customerId, businessId, CLAIM_WINDOW_HOURS]
  );

  if (recentClaims[0]) {
    return res.status(409).json({
      error: `This customer already earned points at this business within the last ${CLAIM_WINDOW_HOURS} hours.`,
      code: 'CLAIM_WINDOW_ACTIVE',
    });
  }

  // --- Step 3: award points atomically ---
  const { rows: businessRows } = await query(
    'SELECT points_per_visit FROM businesses WHERE id = $1',
    [businessId]
  );
  const pointsEarned = businessRows[0]?.points_per_visit ?? 7; // flat per-visit amount, not tied to purchase amount
  const idempotencyKey = claimIdempotencyKey(transaction.id, customerId);

  try {
    const ledgerRow = await withTransaction(async (client) => {
      await client.query(
        'UPDATE transactions SET claimed_at = now(), customer_id = $2 WHERE id = $1',
        [transaction.id, customerId]
      );
      const { rows } = await client.query(
        `INSERT INTO loyalty_ledger
           (customer_id, business_id, transaction_id, points_earned, idempotency_key, device_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, points_earned, earned_at`,
        [customerId, businessId, transaction.id, pointsEarned, idempotencyKey, deviceId]
      );
      return rows[0];
    });

    return res.status(201).json({
      claimed: true,
      pointsEarned: ledgerRow.points_earned,
      earnedAt: ledgerRow.earned_at,
      purchaseAmountCents: transaction.amount_cents,
    });
  } catch (err) {
    if (err.code === '23505') {
      // idempotency_key collision - this exact claim was already processed
      // (e.g. the app retried after a timeout). Not an error from the
      // customer's perspective; report the existing award instead of
      // erroring or double-awarding.
      const { rows } = await query(
        'SELECT points_earned, earned_at FROM loyalty_ledger WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      return res.status(200).json({ claimed: true, alreadyProcessed: true, ...rows[0] });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to record loyalty claim' });
  }
}));

/**
 * POST /api/loyalty/redeem
 * Spends exactly one reward's worth of points - a fixed cost, read from
 * businesses.reward_threshold (V0 default: 21 for every business).
 * Body: { customerId, rewardDescription }
 * Unlike an earlier draft of this endpoint, the point COST is never taken
 * from the client - staff can't submit an arbitrary pointsToRedeem. This
 * matches the punch-card model: redemption is always "cash in one full
 * reward," never a partial or custom-sized spend. If a customer has
 * multiple rewards stacked (e.g. balance 45 = 2 rewards available at a
 * threshold of 21), staff redeem them one at a time - call this endpoint
 * again for a second reward.
 *
 * Sequence:
 *   1. Look up the business's reward_threshold (the fixed cost).
 *   2. Compute the customer's current balance at THIS business (earned
 *      minus already-redeemed), inside the same DB transaction as the
 *      insert below, to keep the check-then-write race window small.
 *   3. Reject if balance < reward_threshold.
 *   4. Insert the redemption for exactly reward_threshold points.
 *
 * Known V0 limitation: two simultaneous redemption requests for the same
 * customer could both pass the balance check before either commits (a
 * classic check-then-act race). Acceptable for a single-business MVP demo;
 * before a real multi-location launch, add a Postgres advisory lock keyed
 * on (customer_id, business_id) around this whole block, or switch the
 * balance check to a locking query instead of the ad hoc aggregate used here.
 */
loyaltyRouter.post('/redeem', requireBusinessDevice, asyncHandler(async (req, res) => {
  const { customerId, rewardDescription } = req.body;
  const businessId = req.auth.businessId; // trust the authenticated device, not client input
  const deviceId = req.auth.deviceId;

  if (!customerId || !rewardDescription) {
    return res.status(400).json({ error: 'customerId and rewardDescription are required' });
  }
  if (!UUID_RE.test(customerId)) {
    return res.status(400).json({ error: 'customerId is not a valid UUID - did you paste a real id, not a placeholder?' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: businessRows } = await client.query(
        'SELECT reward_threshold FROM businesses WHERE id = $1',
        [businessId]
      );
      const rewardThreshold = businessRows[0]?.reward_threshold ?? 21;

      const { rows: balanceRows } = await client.query(
        `SELECT
           COALESCE(SUM(l.points_earned), 0) AS earned,
           COALESCE((
             SELECT SUM(r.points_used) FROM redemptions r
             WHERE r.customer_id = $1 AND r.business_id = $2
           ), 0) AS redeemed
         FROM loyalty_ledger l
         WHERE l.customer_id = $1 AND l.business_id = $2`,
        [customerId, businessId]
      );
      const balance = Number(balanceRows[0].earned) - Number(balanceRows[0].redeemed);

      if (balance < rewardThreshold) {
        // Thrown deliberately, caught below - keeps the "insufficient
        // balance" response generation in one place rather than
        // duplicating res.json() calls inside vs. outside a transaction.
        const err = new Error('INSUFFICIENT_BALANCE');
        err.code = 'INSUFFICIENT_BALANCE';
        err.balance = balance;
        err.rewardThreshold = rewardThreshold;
        throw err;
      }

      const { rows } = await client.query(
        `INSERT INTO redemptions (customer_id, business_id, points_used, reward_description, device_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, points_used, reward_description, redeemed_at`,
        [customerId, businessId, rewardThreshold, rewardDescription, deviceId]
      );
      const remainingBalance = balance - rewardThreshold;
      return {
        redemption: rows[0],
        remainingBalance,
        rewardsStillAvailable: Math.floor(remainingBalance / rewardThreshold),
      };
    });

    return res.status(201).json({
      redeemed: true,
      pointsUsed: result.redemption.points_used,
      rewardDescription: result.redemption.reward_description,
      redeemedAt: result.redemption.redeemed_at,
      remainingBalance: result.remainingBalance,
      rewardsStillAvailable: result.rewardsStillAvailable, // e.g. 1 if they had enough stacked for a second reward too
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return res.status(409).json({
        error: `Customer has ${err.balance} points at this business - needs ${err.rewardThreshold} to redeem a reward.`,
        code: 'INSUFFICIENT_BALANCE',
        currentBalance: err.balance,
        rewardThreshold: err.rewardThreshold,
      });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to record redemption' });
  }
}));