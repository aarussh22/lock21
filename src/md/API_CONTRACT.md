# API Contract — Loyalty Platform Backend

**Base URL (business/customer/loyalty/webhook routes):** `https://<your-ngrok-domain>/api`
**Base URL (auth + QR routes):** `https://<your-ngrok-domain>` (no `/api` prefix — see note below)
**Base URL (production):** TBD once deployed

This document is the source of truth for every frontend integration
(iOS customer app + business app). Anything not listed here doesn't exist
yet — check the "Planned" section at the bottom before assuming a gap is a bug.

## Two response envelopes exist in this API — know which one you're calling

- **`/api/business/...`, `/api/customer/...`, `/api/loyalty/...`, `/api/webhooks/...`**
  use `{ "error": "message" }` on failure, with no `ok` field, and just the
  raw JSON payload on success (e.g. `{ "business": {...} }`).
- **`/auth/...` and `/qr/...`** (no `/api` prefix, see below) use
  `{ "ok": true, ...fields }` on success and `{ "ok": false, "error":
  "message" }` on failure, on every response, regardless of HTTP status
  code. This matches the existing iOS `APIClient.swift` contract exactly -
  it was built this way on purpose to match the frontend, not by accident.

## Points model — read this before building any earn/redeem UI

This is a **fixed punch-card model**, not dollar-proportional:

- Every qualifying purchase awards a **flat 7 points**, regardless of
  purchase amount.
- A reward is available every **21 points** (`reward_threshold`).
- Redemption always costs **exactly 21 points** - no partial or custom
  amounts. The frontend never sends a point amount when redeeming.
- Points **stack indefinitely** if not redeemed - a customer can bank
  multiple rewards (e.g. 45 points = 2 rewards available). Each redemption
  call cashes in exactly one reward; call again for a second stacked one.
- How the raw number is *displayed* (e.g. "21+" once a reward is
  available) is a frontend decision - the API always returns true numbers.
- `points_per_visit` (7) and `reward_threshold` (21) are the same for
  every business today - per-business customization is not yet built.

## Error handling — applies to every endpoint

Every endpoint that accepts an id (a UUID) from the client validates it's
well-formed **before** touching the database, returning a clean `400`
instead of crashing. This applies to `deviceId`, `businessId`,
`customerId`, and `:id` in `/business/devices/:id`. Every route is also
wrapped server-side so no malformed request can crash the server or affect
other in-flight requests - if you ever see a raw HTML error page or a
connection failure instead of JSON, that's infrastructure (ngrok/network),
not the API.

## Auth model — four token/credential types

| Type | Issued by | Used for | Header required? |
|---|---|---|---|
| `owner` | `POST /api/business/login` | Business owner: managing staff devices | `Authorization: Bearer <token>` |
| `business_device` | `POST /api/business/devices/login` | Counter staff: scan, claim, redeem | `Authorization: Bearer <token>` |
| `customer` | `POST /api/customer/register` or `/login` | Customer app: balance, history, profile | `Authorization: Bearer <token>` |
| Dev SMS flow | `POST /auth/verify-code` | Customer login/signup for the iOS app | **No header currently** - see note below |

**Important gap to know about:** `/auth/verify-code` DOES issue a
`customer`-type JWT, but the current iOS app does not attach it as a
Bearer header anywhere yet (including on `/qr/token`, which currently
trusts a raw `customerId` in the request body instead). This is flagged
as a known V1 hardening item, not an oversight - see Planned section.

---

## Business Endpoints (`/api/business/...`)

### `POST /api/business/register`
Creates a new business. **Not authenticated.**
```json
// Request
{ "name": "Cactus Coffee Co", "ownerEmail": "owner@cactuscoffee.test", "password": "supersecret123", "address": "123 Richmond St", "city": "London", "province": "ON", "postalCode": "N6A 1A1" }
// Success 201
{ "business": { "id": "uuid", "name": "...", "owner_email": "...", "status": "pending_pos_connection", "created_at": "..." } }
```
`status` starts `pending_pos_connection`, becomes `active` after Square OAuth.

### `POST /api/business/login`
Owner login. **Not authenticated.**
```json
// Request
{ "ownerEmail": "owner@cactuscoffee.test", "password": "supersecret123" }
// Success 200
{ "token": "eyJ..." }  // owner token
```

### `GET /api/business/pos/connect?businessId=<uuid>`
Starts Square OAuth. Open in a browser/webview - it redirects to Square's
login, then back to `/api/business/pos/callback` automatically.

### `POST /api/business/devices`
Provision a staff device. **Auth: `owner`.** `businessId` comes from the token.
```json
// Request
{ "deviceLabel": "Front Counter iPad", "pin": "4321", "role": "staff" }
// Success 201
{ "device": { "id": "uuid", "device_label": "...", "role": "staff", "created_at": "..." } }
```

### `GET /api/business/devices`
List staff devices. **Auth: `owner`.**

### `PATCH /api/business/devices/:id`
Deactivate/reactivate a device. **Auth: `owner`.** Body: `{ "isActive": false }`.

### `POST /api/business/devices/login`
Counter staff login. **Not authenticated (this IS the login).**
```json
// Request
{ "deviceId": "uuid", "pin": "4321" }
// Success 200
{ "token": "eyJ..." }  // business_device token
```

### `GET /api/business/me`
Status check. **Auth: `business_device`.** Returns `status`, `pos_connected`.

---

## Customer Endpoints (`/api/customer/...`)

**⚠️ Legacy path, mostly superseded by `/auth/*` below for the iOS app.**
`POST /api/customer/register` and `/login` still work exactly as before
(with a `smsVerified: true` client-asserted stub) and are untouched - but
the iOS app now signs up/logs in through `/auth/send-code` +
`/auth/verify-code` instead, which does real per-session code
verification. Both paths write to the same `customers` table and are
phone-number-compatible with each other (see normalization note under
`/auth/send-code` below).

### `GET /api/customer/me`
**Auth: `customer`.** Profile + static QR payload.

### `GET /api/customer/balances`
**Auth: `customer`.** Per-business balances.
```json
{ "balances": [ { "business_id": "uuid", "business_name": "Cactus Coffee Co", "points_balance": "21", "reward_threshold": 21, "rewards_available": 1 } ] }
```

### `GET /api/customer/history`
**Auth: `customer`.** Combined earn/redeem feed, `points` positive for
earns (`7`), negative for redemptions (`-21`).

---

## Loyalty Endpoints (`/api/loyalty/...`, business-device authenticated)

### `POST /api/loyalty/scan`
Body: `{ "qrToken": "..." }` OR `{ "phone": "..." }`. Checks the
**rotating** QR token table first (issued by `/qr/token`), falls back to
the older static `customers.qr_token` for backward compatibility.
```json
{ "customer": { "id": "uuid", "first_name": "Alex", "last_name": "Rivera", "phone": "+15195551234", "qr_token": "LC1...." } }
```

### `POST /api/loyalty/claim`
Body: `{ "customerId": "uuid" }`. Awards a flat 7 points if a recent
unclaimed purchase exists and the 24h-per-business rule isn't active.
```json
// Success 201
{ "claimed": true, "pointsEarned": 7, "earnedAt": "...", "purchaseAmountCents": 1200 }
// 409 - 24h rule active
{ "error": "This customer already earned points at this business within the last 24 hours.", "code": "CLAIM_WINDOW_ACTIVE" }
```

### `POST /api/loyalty/redeem`
Body: `{ "customerId": "uuid", "rewardDescription": "Free Coffee" }` - no
point amount sent, always costs exactly `reward_threshold` (21).
```json
// Success 201
{ "redeemed": true, "pointsUsed": 21, "rewardDescription": "Free Coffee", "redeemedAt": "...", "remainingBalance": 0, "rewardsStillAvailable": 0 }
// 409 - not enough points
{ "error": "Customer has 14 points at this business - needs 21 to redeem a reward.", "code": "INSUFFICIENT_BALANCE", "currentBalance": 14, "rewardThreshold": 21 }
```

---

## Auth Endpoints (`/auth/...` — no `/api` prefix, dev SMS flow)

Uses the `{ ok, error }` envelope described at the top of this document.

### `POST /auth/send-code`
Dev-only SMS. Body: `{ "phone": "7055551234" }` (accepts a raw 10-digit
North American number, or an already-E.164 `+1...` number - both get
normalized to `+17055551234` internally, matching the format used
everywhere else in the database).

**Codes are NOT sent by real SMS yet** - they're printed to the backend's
own server console: `[DEV SMS] Verification code for +17055551234:
483927 (expires in 5 min)`. Whoever is running the backend needs to read
that terminal and relay the code during any live demo.

```json
// Success 200
{ "ok": true }
// Failure 400
{ "ok": false, "error": "Invalid phone number" }
```

### `POST /auth/verify-code`
Body: `{ "phone": "7055551234", "code": "483927" }`. Verifies the code
(one-time use, 5-minute expiry), then logs in the matching customer if
one exists, or creates a new phone-only customer if not.

```json
// Success 200
{ "ok": true, "customerId": "uuid", "token": "eyJ..." }
// Failures
{ "ok": false, "error": "Incorrect verification code" }   // wrong code, reused code, or no code was ever sent for this phone
{ "ok": false, "error": "Verification code expired" }      // past the 5-minute window
```

---

## QR Endpoint (`/qr/...` — no `/api` prefix)

Uses the `{ ok, error }` envelope.

### `POST /qr/token`
Issues a fresh, single-use, 5-minute rotating QR token for a customer -
this is what the iOS QR screen displays and refreshes on a timer.

```json
// Request
{ "customerId": "uuid" }
// Success 200
{ "ok": true, "token": "QR2.xxxxxxxxxxxxxxxxxxxxxxxxxxxx", "expiresAt": 1785368450147 }
```
`expiresAt` is milliseconds since epoch.

**⚠️ Known V1 gap:** this route trusts whatever `customerId` is sent in
the body - it does not currently require the `customer` JWT as a Bearer
header, matching how the iOS app calls it today. Not production-safe
long-term; low real-world risk short-term since customer ids are
unguessable UUIDs. See Planned section.

Issuing a new token automatically invalidates any previous still-active
token for that customer - only one rotating token is ever valid at a time.

---

## Webhook Endpoint (`/api/webhooks/square`, Square-only)

Never called by any frontend. Verifies HMAC signature, processes
`payment.updated` events, writes to `transactions`.

---

## Planned — not yet implemented

| Item | Why it matters |
|---|---|
| Real SMS via Twilio (replacing the console-log dev codes) | Required before any real, non-test phone number is used |
| `Authorization: Bearer` on `/qr/token` (and other iOS calls) | Closes the "trust customerId in the body" gap above |
| `POST /business/pos/refresh` | Manual Square token refresh; automatic refresh cron also not built yet |
| Per-business `points_per_visit` / `reward_threshold` configuration | Currently identical for every business |
| Automated test suite | Rules engine (claim/redeem/24h-window) currently verified by hand, not by CI |

---

## Change log

| Date | Change |
|---|---|
| 2026-07-23 | Initial contract - Steps 1-3 (schema, API, Square OAuth+webhook) |
| 2026-07-27 | Owner auth, punch-card points model, `/loyalty/redeem`, crash hardening (UUID validation on every client-supplied id) |
| 2026-08-02 | Dev SMS auth flow (`/auth/send-code`, `/auth/verify-code`) and rotating QR tokens (`/qr/token`) added, matching the live iOS app's `APIClient.swift`/`Config.swift`. Documented the two different response envelopes now in use across the API. |
