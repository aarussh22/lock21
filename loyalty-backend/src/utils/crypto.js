import crypto from 'node:crypto';
import 'dotenv/config';

// AES-256-GCM: encrypt POS access/refresh tokens before they touch the
// database. Even if the database were ever exposed, the raw Square tokens
// (which would let someone act as the business on Square) stay unusable
// without TOKEN_ENCRYPTION_KEY, which lives only in server env vars.

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'hex');

if (KEY.length !== 32 && process.env.NODE_ENV !== 'test') {
  console.warn(
    'WARNING: TOKEN_ENCRYPTION_KEY is missing or not 32 bytes (64 hex chars). ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

/**
 * Encrypts a plaintext string. Returns a single string safe to store in a
 * TEXT column, formatted as: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12); // 96-bit IV is recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

/**
 * Reverses encrypt(). Throws if the ciphertext was tampered with (GCM's
 * auth tag check fails) - treat that as a hard error, not something to
 * silently ignore, since it means the token can't be trusted.
 */
export function decrypt(stored) {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
