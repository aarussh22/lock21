import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { encrypt } from '../utils/crypto.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchPrimaryLocationId,
} from '../services/square.js';

export const squareOAuthRouter = Router();

// In-memory state store for the MVP. A single-process dev server is fine
// with this; move to Redis (or a DB table with a short TTL) once you run
// more than one backend instance, since state must be checkable from
// whichever instance handles the callback.
const pendingStates = new Map(); // state -> { businessId, createdAt }

/**
 * GET /api/business/pos/connect?businessId=...
 * The business app opens this URL (in an in-app browser / system browser)
 * when the owner taps "Connect Square". We generate a one-time state value,
 * remember it server-side, and redirect to Square's own login/consent page -
 * the business enters their Square credentials there, never in our app.
 */
squareOAuthRouter.get('/pos/connect', async (req, res) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  const { rows } = await query('SELECT id FROM businesses WHERE id = $1', [businessId]);
  if (!rows[0]) return res.status(404).json({ error: 'Business not found' });

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { businessId, createdAt: Date.now() });

  const url = buildAuthorizationUrl({ businessId, state });
  return res.redirect(url);
});

/**
 * GET /api/business/pos/callback
 * Square redirects here after the owner approves (or denies) access.
 * On success: exchange the code for tokens, fetch the location id, encrypt
 * and store everything, flip the business to 'active'.
 */
squareOAuthRouter.get('/pos/callback', async (req, res) => {
  const { code, state: rawState, error: squareError } = req.query;

  if (squareError) {
    return res.status(400).send(`Square authorization was not completed: ${squareError}`);
  }

  const [businessId, state] = String(rawState ?? '').split('.');
  const pending = pendingStates.get(state);
  if (!pending || pending.businessId !== businessId) {
    return res.status(400).send('Invalid or expired OAuth state - please try connecting again.');
  }
  pendingStates.delete(state); // one-time use

  try {
    const tokenResponse = await exchangeCodeForToken(code);
    const { accessToken, refreshToken, expiresAt, merchantId } = tokenResponse;

    const locationId = await fetchPrimaryLocationId(accessToken);

    await query(
      `UPDATE businesses SET
         pos_merchant_id = $2,
         pos_location_id = $3,
         pos_access_token_enc = $4,
         pos_refresh_token_enc = $5,
         pos_token_expires_at = $6,
         pos_connected_at = now(),
         status = 'active',
         updated_at = now()
       WHERE id = $1`,
      [businessId, merchantId, locationId, encrypt(accessToken), encrypt(refreshToken), expiresAt]
    );

    // In production, redirect to a friendly "connected!" screen in the app
    // via a deep link (e.g. loyaltyapp://pos-connected) instead of raw text.
    return res.send('Square account connected successfully. You can return to the app.');
  } catch (err) {
    console.error('Square OAuth callback failed:', err);
    return res.status(500).send('Something went wrong connecting your Square account. Please try again.');
  }
});
