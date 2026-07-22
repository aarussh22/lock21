import { Router } from 'express';
import { query } from '../db/pool.js';
import { verifyWebhookSignature } from '../services/square.js';
import 'dotenv/config';

export const squareWebhookRouter = Router();

/**
 * POST /api/webhooks/square
 * Square calls this in real time whenever a subscribed event happens - for
 * us, that's `payment.updated`. This is what lets /api/loyalty/claim find
 * "a purchase was just made here" without ever polling Square.
 *
 * IMPORTANT: this route must receive the RAW request body (not JSON-parsed)
 * because signature verification is computed over the exact bytes Square
 * sent. See server.js, where express.raw() is mounted only on this path,
 * ahead of the global express.json() middleware.
 */
squareWebhookRouter.post('/square', async (req, res) => {
  const signatureHeader = req.headers['x-square-hmacsha256-signature'];
  const notificationUrl = `${process.env.APP_BASE_URL}/api/webhooks/square`;
  const rawBody = req.body.toString('utf8'); // req.body is a Buffer here, see server.js

  const valid = verifyWebhookSignature({ signatureHeader, notificationUrl, rawBody });
  if (!valid) {
    // Do not process anything from a request that fails verification -
    // this is the only thing standing between "Square told us" and
    // "literally anyone who can guess this URL told us."
    console.warn('Rejected Square webhook: signature verification failed');
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(rawBody);

  // Acknowledge receipt immediately regardless of what we do with it -
  // Square retries webhooks that don't get a fast 2xx, and we don't want
  // a slow downstream step to cause duplicate deliveries.
  res.status(200).send('ok');

  try {
    if (event.type === 'payment.updated') {
      await handlePaymentUpdated(event);
    }
    // Extend here later: 'payment.created', 'refund.updated', etc.
  } catch (err) {
    // Logged, not thrown - the HTTP response is already sent. A monitoring/
    // alerting hook (Sentry etc., see Part 4 of the build guide) belongs here.
    console.error('Error processing Square webhook event:', event.type, err);
  }
});

async function handlePaymentUpdated(event) {
  const payment = event.data?.object?.payment;
  if (!payment) return;

  // Only capture completed payments - we don't want a customer claiming
  // points on a payment that's still pending or was later voided.
  if (payment.status !== 'COMPLETED') return;

  const { rows: businessRows } = await query(
    'SELECT id FROM businesses WHERE pos_location_id = $1',
    [payment.location_id]
  );
  const business = businessRows[0];
  if (!business) {
    // A payment came in for a Square location we don't recognize - either
    // a business hasn't finished onboarding, or this is a stale/duplicate
    // webhook subscription. Log and move on rather than erroring loudly.
    console.warn('Webhook for unrecognized Square location_id:', payment.location_id);
    return;
  }

  await query(
    `INSERT INTO transactions
       (business_id, pos_order_id, pos_payment_id, amount_cents, currency, pos_status, pos_created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (business_id, pos_payment_id) DO UPDATE SET
       pos_status = EXCLUDED.pos_status`,
    [
      business.id,
      payment.order_id ?? null,
      payment.id,
      payment.total_money?.amount ?? 0,
      payment.total_money?.currency ?? 'CAD',
      payment.status,
      payment.created_at,
    ]
  );
}
