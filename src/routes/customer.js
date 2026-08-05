import { Router } from 'express';
import { query } from '../db/pool.js';
import { signToken, requireCustomer } from '../middleware/auth.js';
import { generateQrToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const customerRouter = Router();

/**
 * POST /api/customer/register
 * MVP version: phone number is the identity. In production, step 1 is
 * sending an SMS code (Twilio Verify or similar) and this endpoint only
 * runs after that code is confirmed - stubbed here as `smsVerified: true`
 * being required in the body so the rest of the flow is testable today
 * without a live SMS provider wired up yet.
 */
customerRouter.post('/register', asyncHandler(async (req, res) => {
  const { phone, firstName, lastName, email, smsVerified } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone is required' });
  if (!smsVerified) {
    return res.status(400).json({ error: 'phone must be SMS-verified before registration (stub check)' });
  }

  const qrToken = generateQrToken();

  try {
    const { rows } = await query(
      `INSERT INTO customers (phone, email, first_name, last_name, qr_token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, phone, first_name, last_name, qr_token, created_at`,
      [phone, email ?? null, firstName ?? null, lastName ?? null, qrToken]
    );
    const customer = rows[0];
    const token = signToken({ type: 'customer', customerId: customer.id });
    return res.status(201).json({ customer, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A customer already exists with that phone or email' });
    }
    throw err; // handled by the centralized error handler in server.js via asyncHandler
  }
}));

/**
 * POST /api/customer/login
 * Same SMS-verification stub pattern as register - swap `smsVerified` for
 * a real Twilio Verify check before launch.
 */
customerRouter.post('/login', asyncHandler(async (req, res) => {
  const { phone, smsVerified } = req.body;
  if (!phone || !smsVerified) {
    return res.status(400).json({ error: 'phone and a verified SMS code are required' });
  }

  const { rows } = await query('SELECT id FROM customers WHERE phone = $1', [phone]);
  if (!rows[0]) return res.status(404).json({ error: 'No account with that phone number' });

  const token = signToken({ type: 'customer', customerId: rows[0].id });
  return res.json({ token });
}));

/** GET /api/customer/me - profile + QR payload for the "my code" screen */
customerRouter.get('/me', requireCustomer, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, phone, email, first_name, last_name, qr_token, created_at
     FROM customers WHERE id = $1`,
    [req.auth.customerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
  return res.json({ customer: rows[0] });
}));

/**
 * GET /api/customer/balances - per-business point balances for the home
 * screen. Includes reward_threshold and a computed rewards_available count
 * (floor(points_balance / reward_threshold)) so the frontend can show a
 * "reward ready!" indicator without doing that math itself. How exactly the
 * raw balance is displayed (e.g. showing "21+" instead of the real number
 * once a reward is available) is a frontend decision - this endpoint always
 * returns the true numbers.
 */
customerRouter.get('/balances', requireCustomer, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       cb.business_id,
       b.name AS business_name,
       cb.points_balance,
       b.reward_threshold,
       FLOOR(cb.points_balance / b.reward_threshold) AS rewards_available
     FROM customer_balances cb
     JOIN businesses b ON b.id = cb.business_id
     WHERE cb.customer_id = $1
     ORDER BY b.name`,
    [req.auth.customerId]
  );
  return res.json({ balances: rows });
}));

/** GET /api/customer/history - ledger + redemption history for the "activity" screen */
customerRouter.get('/history', requireCustomer, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT 'earn' AS type, l.points_earned AS points, l.earned_at AS occurred_at, b.name AS business_name
     FROM loyalty_ledger l JOIN businesses b ON b.id = l.business_id
     WHERE l.customer_id = $1
     UNION ALL
     SELECT 'redeem' AS type, -r.points_used AS points, r.redeemed_at AS occurred_at, b.name AS business_name
     FROM redemptions r JOIN businesses b ON b.id = r.business_id
     WHERE r.customer_id = $1
     ORDER BY occurred_at DESC
     LIMIT 100`,
    [req.auth.customerId]
  );
  return res.json({ history: rows });
}));