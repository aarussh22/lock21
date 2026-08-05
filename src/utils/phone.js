/**
 * Normalizes a phone number to E.164 (+1XXXXXXXXXX) so the new dev SMS
 * flow (POST /auth/send-code, /auth/verify-code) agrees with the format
 * already used by the older /api/customer/register flow and stored in
 * customers.phone. Without this, the same real phone number could end up
 * as two different-looking rows depending on which flow created it.
 *
 * Handles:
 *   "7055551234"      -> "+17055551234"  (10 digits, assume North America)
 *   "17055551234"     -> "+17055551234"  (11 digits starting with 1)
 *   "+17055551234"    -> "+17055551234"  (already E.164, passed through)
 *
 * Returns null if the input can't be confidently normalized - the caller
 * treats that as an invalid phone number. This is deliberately narrow
 * (North America only) rather than a general international parser; add a
 * real library (e.g. libphonenumber) before this needs to support
 * international numbers.
 */
export function normalizePhone(raw) {
    if (typeof raw !== 'string') return null;

    const digitsOnly = raw.replace(/\D/g, '');

    if (raw.trim().startsWith('+')) {
        // Already has a country code - just validate it's a plausible length
        // (E.164 max is 15 digits) and pass it through as-is.
        if (digitsOnly.length < 8 || digitsOnly.length > 15) return null;
        return `+${digitsOnly}`;
    }

    if (digitsOnly.length === 10) {
        return `+1${digitsOnly}`;
    }
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        return `+${digitsOnly}`;
    }

    return null; // couldn't confidently normalize - treat as invalid
}