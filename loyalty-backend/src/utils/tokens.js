import crypto from 'node:crypto';

/**
 * Generates the opaque token that gets encoded into a customer's QR code.
 * Deliberately NOT the customer's database id - this can be rotated
 * (e.g. customer says "someone else might have my QR code") without
 * touching their id, phone, or history.
 * Prefixed so the business app can sanity-check a scanned payload before
 * ever sending it to the server (cheap malformed-QR rejection).
 */
export function generateQrToken() {
  return `LC1.${crypto.randomBytes(20).toString('base64url')}`;
}

/**
 * Deterministic idempotency key for a claim attempt, built from the
 * transaction being claimed against. If the business app retries a claim
 * request after a network timeout, this ensures the ledger insert is
 * rejected as a duplicate (UNIQUE constraint) rather than double-awarding
 * points. See routes/loyalty.js.
 */
export function claimIdempotencyKey(transactionId, customerId) {
  return crypto
    .createHash('sha256')
    .update(`claim:${transactionId}:${customerId}`)
    .digest('hex');
}
