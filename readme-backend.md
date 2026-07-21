# Loyalty Platform — Business-Side Backend (Steps 1–3)

This covers **Part 2, Steps 1–3** from the build guide:
1. Data model (Postgres schema)
2. Backend API (Express)
3. Square POS integration (OAuth + webhooks)

Everything in here has been syntax-checked, dependency-installed, and
**run end-to-end against a live local Postgres instance** — business
registration, device provisioning, customer registration, QR scan, points
claim, and the 24-hour-per-business rule (including the block case) all
verified working.

## What's implemented

| File | Purpose |
|---|---|
| `src/db/migrations/001_init.sql` | Full schema: businesses, business_devices, customers, transactions, loyalty_ledger, redemptions, plus a `customer_balances` view |
| `src/db/pool.js`, `src/db/migrate.js` | Connection pool + a minimal migration runner (`npm run migrate`) |
| `src/utils/crypto.js` | AES-256-GCM encrypt/decrypt for POS tokens at rest |
| `src/utils/tokens.js` | QR token generation, claim idempotency keys |
| `src/middleware/auth.js` | JWT auth for two audiences: business devices (counter staff) and customers |
| `src/routes/business.js` | Business owner registration, staff device provisioning + PIN login |
| `src/routes/customer.js` | Customer registration/login (SMS-verification stubbed), profile, balances, history |
| `src/routes/loyalty.js` | **The rules engine** — `/scan` (QR or phone lookup) and `/claim` (purchase check + 24h rule + atomic ledger write) |
| `src/services/square.js` | Square OAuth URL building, token exchange/refresh, webhook signature verification (via the official SDK's `WebhooksHelper`) |
| `src/routes/square-oauth.js` | `/api/business/pos/connect` and `/pos/callback` — the "Connect Square" flow |
| `src/routes/square-webhook.js` | Receives `payment.updated` events, populates `transactions` |
| `src/server.js` | Wires it all together (note the webhook route needs raw body parsing — see comments in the file, order matters) |

## Running it locally

```bash
npm install
cp .env.example .env
# fill in: DATABASE_URL, JWT_SECRET, TOKEN_ENCRYPTION_KEY (generate with the
# node -e command in .env.example), and your Square sandbox app credentials
npm run migrate
npm run dev
```

Health check: `GET http://localhost:4000/health`

## Testing the Square OAuth + webhook pieces for real

The OAuth and webhook *code* is written against the real Square SDK (v38)
and has been verified to load and call the SDK correctly, but exercising it
live requires two things I couldn't do in this sandboxed environment:

1. **A Square Developer sandbox app** — sign up at
   [developer.squareup.com](https://developer.squareup.com), create a
   sandbox application, and drop the Application ID / Secret into `.env`.
2. **A public HTTPS URL for webhooks** — Square can't call `localhost`.
   Use [ngrok](https://ngrok.com) during development:
   ```bash
   ngrok http 4000
   ```
   Then set `APP_BASE_URL` in `.env` to the ngrok URL, and register
   `https://<your-ngrok-url>/api/webhooks/square` as the webhook
   notification URL in the Square Developer Dashboard, subscribed to the
   `payment.updated` event. Copy the "Signature Key" Square shows you into
   `SQUARE_WEBHOOK_SIGNATURE_KEY`.

Once both are set, the real flow is:
1. Open `http://localhost:4000/api/business/pos/connect?businessId=<id>` in
   a browser → redirects to Square's sandbox login → approve → redirects
   back to `/pos/callback` → business flips to `active` with real
   `pos_location_id` and encrypted tokens stored.
2. Make a test payment against that sandbox location (Square's sandbox lets
   you simulate card payments) → your webhook receives `payment.updated` →
   a row appears in `transactions` → `/api/loyalty/claim` can now find it.

## What was verified in this session

```
✓ npm install completes cleanly (all dependency versions resolve)
✓ Every .js file passes `node --check` (no syntax errors)
✓ services/square.js loads and calls the real installed SDK correctly
  (corrected from an initial wrong assumption about the SDK's API shape —
  the installed square@38.2.0 uses Client/Environment/oAuthApi, not the
  newer SquareClient pattern I first guessed at)
✓ Migration runs clean against real Postgres 16
✓ Full request flow tested against the running server:
  register business → provision device → device login → register customer
  → scan QR → claim points (succeeds) → second claim same store/same day
  (correctly blocked, HTTP 409) → customer balance & history (correct)
```

## Known gaps to close before this is pilot-ready

- `POST /api/business/devices` (provisioning a new staff PIN) has no auth
  guard yet — needs an owner-level JWT type distinct from the device JWT,
  so only the business owner's dashboard can create new staff devices.
- SMS verification (`smsVerified: true` in the customer routes) is a stub.
  Wire up Twilio Verify (or similar) before this handles real phone numbers.
- Token refresh (`refreshAccessToken` in `services/square.js`) is written
  but nothing calls it on a schedule yet — needs a small cron job checking
  `pos_token_expires_at` across all active businesses.
- `pendingStates` in `square-oauth.js` is in-memory, fine for one backend
  instance/local dev, not fine once you run more than one server process.

## Next session: Steps 4–8

Step 4 (business app UI), Step 5 (customer app UI), Step 6 (24h rule test
suite — the manual tests above should become automated Jest/Vitest tests),
Step 7 (pilot with a real business), Step 8 (second POS provider).
