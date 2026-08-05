import { Router } from 'express';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { signToken } from '../middleware/auth.js';
import { generateQrToken } from '../utils/tokens.js';
import { normalizePhone } from '../utils/phone.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRouter = Router();

const CODE_EXPIRY_MINUTES = 5;

// Response envelope note: these two routes use { ok, error } on every
// response (success and failure alike), matching APIClient.swift's
// explicit contract ("Our backend always returns { ok: false, error: '...' }
// on failure, regardless of HTTP status code"). This is DIFFERENT from the
// { error: "..." } convention used elsewhere in this backend
// (/api/business/..., /api/customer/...) - that's intentional, not an
// inconsistency to "fix" - these routes exist specifically to match what
// the iOS app already expects.

/**
 * POST /auth/send-code
 * Body: { phone }
 * Dev-only: generates a 6-digit code, stores it with a 5-minute expiry,
 * and PRINTS IT TO THE SERVER CONSOLE instead of sending a real SMS.
 * No Twilio integration yet - swap the console.log below for a real SMS
 * provider call when that's ready; nothing else about this route changes.
 */
authRouter.post('/send-code', asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
        return res.status(400).json({ ok: false, error: 'Invalid phone number' });
    }

    const code = crypto.randomInt(100000, 1000000).toString(); // 6 digits, zero-padding not needed (randomInt's range guarantees 6 digits)
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    await withTransaction(async (client) => {
        // Invalidate any still-outstanding codes for this phone first, so only
        // the most recently sent code is ever valid - avoids a confusing state
        // where an old code from a previous attempt still works.
        await client.query(
            `UPDATE phone_verification_codes SET consumed_at = now()
       WHERE phone = $1 AND consumed_at IS NULL`,
            [phone]
        );
        await client.query(
            `INSERT INTO phone_verification_codes (phone, code, expires_at)
       VALUES ($1, $2, $3)`,
            [phone, code, expiresAt]
        );
    });

    // DEV ONLY - this is the "SMS." Remove/replace when a real provider is wired up.
    console.log(`[DEV SMS] Verification code for ${phone}: ${code} (expires in ${CODE_EXPIRY_MINUTES} min)`);

    return res.json({ ok: true });
}));

/**
 * POST /auth/verify-code
 * Body: { phone, code }
 * Verifies the code, then either logs in an existing customer or creates
 * a new one (phone-only - no name/email required at this stage, matching
 * what the iOS onboarding flow currently collects). Returns a JWT even
 * though APIClient.swift doesn't currently attach it as a Bearer header
 * anywhere - included for forward compatibility once the app wires up
 * proper session storage; harmless to ignore in the meantime.
 */
authRouter.post('/verify-code', asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;

    if (!phone) {
        return res.status(400).json({ ok: false, error: 'Invalid phone number' });
    }
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ ok: false, error: 'Incorrect verification code' });
    }

    const { rows } = await query(
        `SELECT id, code, expires_at FROM phone_verification_codes
     WHERE phone = $1 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
        [phone]
    );
    const pending = rows[0];

    // No outstanding code at all - treat the same as "wrong code" rather
    // than a distinct error, so this endpoint doesn't leak whether a code
    // was ever requested for a given phone number.
    if (!pending) {
        return res.status(401).json({ ok: false, error: 'Incorrect verification code' });
    }
    if (new Date(pending.expires_at) < new Date()) {
        return res.status(400).json({ ok: false, error: 'Verification code expired' });
    }
    if (pending.code !== code) {
        return res.status(401).json({ ok: false, error: 'Incorrect verification code' });
    }

    // Correct code - consume it (can't be reused) and look up or create the customer.
    const result = await withTransaction(async (client) => {
        await client.query(
            'UPDATE phone_verification_codes SET consumed_at = now() WHERE id = $1',
            [pending.id]
        );

        const { rows: existing } = await client.query(
            'SELECT id FROM customers WHERE phone = $1',
            [phone]
        );

        if (existing[0]) {
            return { customerId: existing[0].id };
        }

        // New customer, phone-only (matches the iOS onboarding flow, which
        // doesn't collect a name at this step). qr_token still gets a static
        // value at creation for backward-compat lookups (see routes/loyalty.js
        // scan handler), even though the app itself will use the ROTATING
        // token from POST /qr/token, not this static one, going forward.
        const { rows: created } = await client.query(
            `INSERT INTO customers (phone, qr_token)
       VALUES ($1, $2)
       RETURNING id`,
            [phone, generateQrToken()]
        );
        return { customerId: created[0].id };
    });

    const token = signToken({ type: 'customer', customerId: result.customerId });

    return res.json({ ok: true, customerId: result.customerId, token });
}));