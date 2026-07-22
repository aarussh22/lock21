# Changes Section (to do list)

## July 14

---

Icon - change
Made in change made for
Tagline needed
I run a business remove
Register no option

---

Taglines
Reward system
What lock21
Different tier

New user pwd: Lock21-new
env. file:
''

# --- Server ---

PORT=4000
NODE_ENV=development
APP_BASE_URL=http://localhost:4000 # used to build the Square OAuth redirect_uri

# --- Database ---

DATABASE_URL=postgresql://postgres:dkYezUz!Y%55okS1ITrK@db.zfumpvivzwpbsdrhfszu.supabase.co:5432/postgres

# --- Auth (JWTs issued to business devices and customers) ---

JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=12h

# --- Token encryption (AES-256-GCM key for POS access/refresh tokens at rest) ---

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

TOKEN_ENCRYPTION_KEY=replace-with-64-hex-characters

# --- Square (sandbox first, swap to production values later) ---

SQUARE_ENVIRONMENT=sandbox # sandbox | production
SQUARE_APPLICATION_ID=sandbox-sq0idb-EwEcYJ1XFch4dyNGFNlceg
SQUARE_APPLICATION_SECRET=sandbox-sq0csb-CpKqFab7DqXj-zdTEd4_o8j981daB9DN6LI4kV2QrAM
SQUARE_WEBHOOK_SIGNATURE_KEY=replace-with-value-from-square-dashboard

# --- Loyalty business rule ---

CLAIM_WINDOW_HOURS=24 # the "once per store per 24h" rule, kept configurable

''
