import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { generateRotatingQrToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const qrRouter = Router();

const QR_TOKEN_EXPIRY_MINUTES = 5; // matches Config.qrRefreshInterval on the iOS side
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /qr/token
 * Body: { customerId }
 * Issues a fresh, single-use, 5-minute rotating QR token for a customer.
 * Called when the QR screen appears, and again on a timer, per
 * Config.qrRefreshInterval / QRCodeView on the iOS side.
 *
 * KNOWN V0 GAP: this route is NOT authenticated - it trusts whatever
 * customerId is sent in the body, matching how APIClient.swift currently
 * calls it (no Authorization header attached anywhere in that file yet).
 * Since customerId is a UUID, this isn't trivially guessable, but it IS a
 * real gap: anyone who somehow learned another customer's id could pull
 * their live QR token. Close this once the app attaches the JWT issued by
 * /auth/verify-code as a Bearer header - at that point, swap the body
 * lookup below for requireCustomer middleware (see middleware/auth.js)
 * and read req.auth.customerId instead of trusting the request body.
 */
qrRouter.post('/token', asyncHandler(async (req, res) => {
    const { customerId } = req.body;

    if (!customerId) {
        return res.status(400).json({ ok: false, error: 'customerId is required' });
    }
    if (!UUID_RE.test(customerId)) {
        return res.status(400).json({ ok: false, error: 'customerId is not a valid UUID' });
    }

    const { rows: customerRows } = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!customerRows[0]) {
        return res.status(404).json({ ok: false, error: 'Customer not found' });
    }

    const token = generateRotatingQrToken();
    const expiresAt = new Date(Date.now() + QR_TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await withTransaction(async (client) => {
        // Invalidate any still-active token for this customer before issuing a
        // new one - keeps at most one live rotating token per customer at a
        // time, so an old screenshotted code can't linger as "still valid"
        // just because it hadn't hit its own expiry yet.
        await client.query(
            `UPDATE qr_tokens SET used_at = now()
       WHERE customer_id = $1 AND used_at IS NULL`,
            [customerId]
        );
        await client.query(
            `INSERT INTO qr_tokens (customer_id, token, expires_at)
       VALUES ($1, $2, $3)`,
            [customerId, token, expiresAt]
        );
    });

    // expiresAt as milliseconds since epoch, matching what APIClient.swift
    // expects: Date(timeIntervalSince1970: expiresAtMs / 1000)
    return res.json({ ok: true, token, expiresAt: expiresAt.getTime() });
}));