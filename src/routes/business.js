import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { signToken, requireBusinessDevice, requireBusinessOwner } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const businessRouter = Router();

/**
 * POST /api/business/register
 * Business owner signs up for the dashboard. This is NOT the counter login -
 * see /devices below for that. Creates the business row in 'pending_pos_connection'
 * status; they can't accept claims until Step 3 (Square OAuth) is completed.
 */
businessRouter.post('/register', asyncHandler(async (req, res) => {
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
    throw err; // handled by the centralized error handler in server.js via asyncHandler
  }
}));

/**
 * POST /api/business/login
 * The business OWNER's login - distinct from /devices/login below, which is
 * for counter staff. This is what a future owner dashboard would call.
 * Returns an 'owner'-typed JWT, required by requireBusinessOwner below.
 */
businessRouter.post('/login', asyncHandler(async (req, res) => {
  const { ownerEmail, password } = req.body;
  if (!ownerEmail || !password) {
    return res.status(400).json({ error: 'ownerEmail and password are required' });
  }

  const { rows } = await query(
    'SELECT id, owner_password_hash FROM businesses WHERE owner_email = $1',
    [ownerEmail.toLowerCase()]
  );
  const business = rows[0];

  // Deliberately identical error for "no such email" and "wrong password" -
  // distinguishing them lets an attacker enumerate registered business
  // emails, which is worth avoiding even at MVP stage.
  if (!business) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const passwordMatches = await bcrypt.compare(password, business.owner_password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken({ type: 'owner', businessId: business.id });
  return res.json({ token });
}));

/**
 * POST /api/business/devices
 * Owner provisions a new counter device/staff PIN. Auth: owner only.
 * businessId comes from the authenticated owner's token, NOT the request
 * body - same "trust the token, not client input" pattern used in
 * loyalty.js's claim endpoint. This closes the gap where anyone who knew
 * a businessId could previously create a staff login for that business.
 */
businessRouter.post('/devices', requireBusinessOwner, asyncHandler(async (req, res) => {
  const { deviceLabel, pin, role } = req.body;
  const businessId = req.auth.businessId;

  if (!deviceLabel || !pin) {
    return res.status(400).json({ error: 'deviceLabel and pin are required' });
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
}));

/**
 * GET /api/business/devices
 * Owner-only. Lists every staff device for their business, so a future
 * owner dashboard can show/manage them.
 */
businessRouter.get('/devices', requireBusinessOwner, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, device_label, role, is_active, created_at, last_used_at
     FROM business_devices
     WHERE business_id = $1
     ORDER BY created_at DESC`,
    [req.auth.businessId]
  );
  return res.json({ devices: rows });
}));

/**
 * PATCH /api/business/devices/:id
 * Owner-only. Deactivates (or reactivates) a device - e.g. a lost tablet.
 * Scoped to req.auth.businessId in the WHERE clause so an owner can never
 * touch a device belonging to a different business, even if they somehow
 * knew its id. Validates :id looks like a UUID before it ever reaches
 * Postgres - a malformed id now returns a clean 400 instead of relying on
 * asyncHandler to catch a DB-level crash (belt and suspenders: this check
 * is fast/cheap and gives a much clearer error message than a raw
 * Postgres "invalid input syntax" would).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

businessRouter.patch('/devices/:id', requireBusinessOwner, asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive (boolean) is required' });
  }
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'device id in the URL is not a valid UUID' });
  }

  const { rows } = await query(
    `UPDATE business_devices
     SET is_active = $1
     WHERE id = $2 AND business_id = $3
     RETURNING id, device_label, role, is_active`,
    [isActive, req.params.id, req.auth.businessId]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: 'Device not found for this business' });
  }
  return res.json({ device: rows[0] });
}));

/**
 * POST /api/business/devices/login
 * The screen staff actually use at the counter each shift: pick the device,
 * enter the PIN. Returns a short-lived JWT scoped to that business/device -
 * this is what authorizes /api/customer/scan and /api/loyalty/claim below.
 * Validates deviceId looks like a UUID up front - this is exactly the field
 * that crashed the server when a placeholder string was sent instead of a
 * real id; this check turns that into a clean 400 instead.
 */
businessRouter.post('/devices/login', asyncHandler(async (req, res) => {
  const { deviceId, pin } = req.body;
  if (!deviceId || !pin) {
    return res.status(400).json({ error: 'deviceId and pin are required' });
  }
  if (!UUID_RE.test(deviceId)) {
    return res.status(400).json({ error: 'deviceId is not a valid UUID - did you paste a real id, not a placeholder?' });
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
}));

/**
 * GET /api/business/me
 * Sanity-check endpoint for the business app to confirm the token is valid
 * and fetch the connected business's basic info + POS connection status.
 */
businessRouter.get('/me', requireBusinessDevice, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, status, pos_provider, pos_location_id IS NOT NULL AS pos_connected
     FROM businesses WHERE id = $1`,
    [req.auth.businessId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Business not found' });
  return res.json({ business: rows[0] });
}));