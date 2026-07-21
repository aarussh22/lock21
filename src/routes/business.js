import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { signToken, requireBusinessDevice } from '../middleware/auth.js';

export const businessRouter = Router();

/**
 * POST /api/business/register
 * Business owner signs up for the dashboard. This is NOT the counter login -
 * see /devices below for that. Creates the business row in 'pending_pos_connection'
 * status; they can't accept claims until Step 3 (Square OAuth) is completed.
 */
businessRouter.post('/register', async (req, res) => {
  const { name, ownerEmail, password, address, city, province, postalCode } = req.body;

  if (!name || !ownerEmail || !password) {
    return res.status(400).json({ error: 'name, ownerEmail, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await query(
      `INSERT INTO businesses (name, owner_email, owner_password_hash, address, city, province, postal_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, owner_email, status, created_at`,
      [name, ownerEmail.toLowerCase(), passwordHash, address ?? null, city ?? null, province ?? null, postalCode ?? null]
    );
    return res.status(201).json({ business: rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation on owner_email
      return res.status(409).json({ error: 'A business is already registered with that email' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to register business' });
  }
});

/**
 * POST /api/business/devices
 * Owner provisions a new counter device/staff PIN. Requires the owner to be
 * authenticated in a real build (omitted here for brevity - add an
 * `requireBusinessOwner` middleware analogous to requireBusinessDevice
 * before this ships, gated on a separate owner JWT type).
 */
businessRouter.post('/devices', async (req, res) => {
  const { businessId, deviceLabel, pin, role } = req.body;
  if (!businessId || !deviceLabel || !pin) {
    return res.status(400).json({ error: 'businessId, deviceLabel, and pin are required' });
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'pin must be 4-6 digits' });
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const { rows } = await query(
    `INSERT INTO business_devices (business_id, device_label, pin_hash, role)
     VALUES ($1, $2, $3, COALESCE($4, 'staff'))
     RETURNING id, device_label, role, created_at`,
    [businessId, deviceLabel, pinHash, role ?? null]
  );
  return res.status(201).json({ device: rows[0] });
});

/**
 * POST /api/business/devices/login
 * The screen staff actually use at the counter each shift: pick the device,
 * enter the PIN. Returns a short-lived JWT scoped to that business/device -
 * this is what authorizes /api/customer/scan and /api/loyalty/claim below.
 */
businessRouter.post('/devices/login', async (req, res) => {
  const { deviceId, pin } = req.body;
  if (!deviceId || !pin) {
    return res.status(400).json({ error: 'deviceId and pin are required' });
  }

  const { rows } = await query(
    `SELECT d.id, d.pin_hash, d.role, d.is_active, d.business_id, b.status AS business_status
     FROM business_devices d
     JOIN businesses b ON b.id = d.business_id
     WHERE d.id = $1`,
    [deviceId]
  );
  const device = rows[0];
  if (!device || !device.is_active) {
    return res.status(401).json({ error: 'Invalid device or PIN' });
  }

  const pinMatches = await bcrypt.compare(pin, device.pin_hash);
  if (!pinMatches) {
    return res.status(401).json({ error: 'Invalid device or PIN' });
  }
  if (device.business_status !== 'active') {
    return res.status(403).json({ error: 'This business has not finished connecting its POS yet' });
  }

  await query('UPDATE business_devices SET last_used_at = now() WHERE id = $1', [device.id]);

  const token = signToken({
    type: 'business_device',
    deviceId: device.id,
    businessId: device.business_id,
    role: device.role,
  });

  return res.json({ token });
});

/**
 * GET /api/business/me
 * Sanity-check endpoint for the business app to confirm the token is valid
 * and fetch the connected business's basic info + POS connection status.
 */
businessRouter.get('/me', requireBusinessDevice, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, status, pos_provider, pos_location_id IS NOT NULL AS pos_connected
     FROM businesses WHERE id = $1`,
    [req.auth.businessId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Business not found' });
  return res.json({ business: rows[0] });
});
