import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET;

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN ?? '12h' });
}

function verifyRequest(req, res, next, expectedType) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== expectedType) {
      return res.status(403).json({ error: `Token is not a ${expectedType} token` });
    }
    req.auth = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Applied to routes only a logged-in counter device/staff PIN should reach
// (scanning customers, claiming points). req.auth = { type, deviceId, businessId, role }
export function requireBusinessDevice(req, res, next) {
  verifyRequest(req, res, next, 'business_device');
}

// Applied to routes only a logged-in customer app should reach.
// req.auth = { type, customerId }
export function requireCustomer(req, res, next) {
  verifyRequest(req, res, next, 'customer');
}
