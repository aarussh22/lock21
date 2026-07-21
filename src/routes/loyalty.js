import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireBusinessDevice } from '../middleware/auth.js';
import { claimIdempotencyKey } from '../utils/tokens.js';
import 'dotenv/config';

export const loyaltyRouter = Router();

const CLAIM_WINDOW_HOURS = Number(process.env.CLAIM_WINDOW_HOURS ?? 24);
// How far back we'll look for an unclaimed purchase when staff hits "claim" -
// this is NOT the 24h loyalty rule, it's a separate, much shorter window that
// answers "did this customer just buy something at this register." Keeps a
// customer from claiming points on a sale from three days ago that they
// forgot to scan for at the time.
const RECENT_PURCHASE_WINDOW_MINUTES = 30;

/**
 * POST /api/loyalty/scan
 * Business device sends either a scanned QR payload OR a manually-typed
 * phone number (satisfies requirement #5 - both entry modes hit this same
 * endpoint, the app just decides which field to fill in).
 * Body: { qrToken } OR { phone }
 */
loyaltyRouter.post('/scan', requireBusinessDevice, async (req, res) => {
  const { qrToken, phone } = req.body;
  if (!qrToken && !phone) {
    return res.status(400).json({ error: 'Provide either qrToken or phone' });
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
});

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
loyaltyRouter.post('/claim', requireBusinessDevice, async (req, res) => {
  const { customerId } = req.body;
  const businessId = req.auth.businessId; // trust the authenticated device, not client input
  const deviceId = req.auth.deviceId;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
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
    'SELECT points_per_dollar FROM businesses WHERE id = $1',
    [businessId]
  );
  const pointsPerDollar = Number(businessRows[0]?.points_per_dollar ?? 1);
  const pointsEarned = Math.floor((transaction.amount_cents / 100) * pointsPerDollar);
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
});
