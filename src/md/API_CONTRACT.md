# API Contract — Loyalty Platform Backend

**Base URL (local dev):** `https://straddle-hut-phantom.ngrok-free.dev/api`
**Base URL (production):** TBD once deployed

This document is the source of truth for every frontend integration
(business app + customer app). Anything not listed here doesn't exist yet
— check the "Planned" section at the bottom before assuming a gap is a bug.

## Auth model — three token types

All authenticated routes expect `Authorization: Bearer <token>`. There are
three kinds of JWT, and using the wrong one on a route returns `403`:

| Token type        | Issued by                                              | Used for                                                            |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `business_device` | `POST /business/devices/login`                         | Counter staff actions: scanning customers, claiming points          |
| `owner`           | `POST /business/login` _(not yet built — see Planned)_ | Business owner dashboard actions: managing devices, viewing reports |
| `customer`        | `POST /customer/register` or `/customer/login`         | Customer app: viewing balance, history, profile                     |

Tokens expire per `JWT_EXPIRES_IN` in `.env` (currently 12h). A `401` with
`"Invalid or expired token"` means: re-authenticate, don't retry blindly.

---

## Business Endpoints

### `POST /business/register`

Creates a new business. **Not authenticated.**

**Request body:**

```json
{
  "name": "Cactus Coffee Co",
  "ownerEmail": "owner@cactuscoffee.test",
  "password": "at least 8 characters",
  "address": "123 Richmond St",
  "city": "London",
  "province": "ON",
  "postalCode": "N6A 1A1"
}
```

`name`, `ownerEmail`, `password` are required. Everything else optional.

**Success — `201`:**

```json
{
  "business": {
    "id": "uuid",
    "name": "Cactus Coffee Co",
    "owner_email": "owner@cactuscoffee.test",
    "status": "pending_pos_connection",
    "created_at": "2026-07-19T00:30:00.000Z"
  }
}
```

Note: `status` starts as `pending_pos_connection` and only becomes
`active` after the business completes Square OAuth (see below). A
business app should treat `pending_pos_connection` as "show the Connect
Square screen, block everything else."

**Errors:**
| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error": "name, ownerEmail, and password are required"}` | Missing field |
| `400` | `{"error": "password must be at least 8 characters"}` | Weak password |
| `409` | `{"error": "A business is already registered with that email"}` | Duplicate email |

---

### `GET /business/pos/connect?businessId=<uuid>`

Starts the Square OAuth flow. **Not authenticated** (businessId in the
query string is the only identifier — this is a browser redirect target,
not a JSON API call). Open this in an actual browser/webview, not via
fetch/axios — it 302-redirects to Square's login page.

**Query params:** `businessId` (required, must be a valid UUID)

**Behavior:** redirects (`302`) to Square's hosted OAuth consent screen.
After the business owner approves, Square redirects back to
`/business/pos/callback` automatically — the frontend doesn't need to
handle that leg itself, just needs to open this URL and let the redirect
chain complete (e.g. in an in-app browser / `WebView` component), then
poll or refresh `GET /business/me` afterward to confirm `status` flipped
to `active`.

**Errors:**
| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error": "businessId is required"}` | Missing param |
| `400` | `{"error": "businessId is not a valid UUID"}` | Malformed param |
| `404` | `{"error": "Business not found"}` | Bad businessId |

---

### `GET /business/pos/callback`

Square's redirect target. **Frontend never calls this directly** — it's
hit automatically as part of the browser redirect chain from
`/pos/connect`. Returns a plain-text HTML confirmation page. Included here
for completeness only.

---

### `POST /business/devices`

Provisions a new counter staff device/PIN.

**⚠️ Currently unauthenticated — this is a known gap, tracked in the
roadmap (owner auth not built yet). Do not treat this as a stable,
public-safe endpoint. It will require an `owner` bearer token once that
work lands; expect the request shape below to stay the same when that
happens.**

**Request body:**

```json
{
  "businessId": "uuid",
  "deviceLabel": "Front Counter iPad",
  "pin": "4321",
  "role": "staff"
}
```

`pin` must be 4–6 digits. `role` optional, defaults to `"staff"` (other
valid value: `"manager"`).

**Success — `201`:**

```json
{
  "device": {
    "id": "uuid",
    "device_label": "Front Counter iPad",
    "role": "staff",
    "created_at": "2026-07-19T00:31:00.000Z"
  }
}
```

**Errors:**
| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error": "businessId, deviceLabel, and pin are required"}` | Missing field |
| `400` | `{"error": "pin must be 4-6 digits"}` | Invalid PIN format |

---

### `POST /business/devices/login`

The screen counter staff use each shift.

**Request body:**

```json
{ "deviceId": "uuid", "pin": "4321" }
```

**Success — `200`:**

```json
{ "token": "eyJhbGciOi..." }
```

Store this token (secure storage, not plain AsyncStorage/localStorage) and
send it as `Authorization: Bearer <token>` on every subsequent business
device request.

**Errors:**
| Status | Body | Meaning |
|---|---|---|
| `401` | `{"error": "Invalid device or PIN"}` | Wrong PIN, unknown device, or device deactivated |
| `403` | `{"error": "This business has not finished connecting its POS yet"}` | Business status isn't `active` — send them to reconnect Square |

---

### `GET /business/me`

Sanity check + status poll. **Auth: `business_device`.**

**Success — `200`:**

```json
{
  "business": {
    "id": "uuid",
    "name": "Cactus Coffee Co",
    "status": "active",
    "pos_provider": "square",
    "pos_connected": true
  }
}
```

The business app should poll this (or call it once when returning from
the OAuth browser flow) to detect the `pending_pos_connection` → `active`
transition.

**Errors:** `404` if the business was deleted after the token was issued
(edge case, unlikely in practice).

---

## Customer Endpoints

### `POST /customer/register`

\*\*⚠️ `smsVerified` is currently a client-asserted boolean, not real SMS
verification — tracked in the roadmap. Treat this field as temporary; it
will be replaced by a verification-ticket flow (`/customer/verify/start`

- `/customer/verify/check`) without changing the rest of this endpoint's
  shape.\*\*

**Request body:**

```json
{
  "phone": "+15195551234",
  "firstName": "Alex",
  "lastName": "Rivera",
  "email": "alex@example.com",
  "smsVerified": true
}
```

`phone` required, must be E.164 format (`+` + country code + number, no
spaces/dashes). `smsVerified` currently required to be `true` (temporary).

**Success — `201`:**

```json
{
  "customer": {
    "id": "uuid",
    "phone": "+15195551234",
    "first_name": "Alex",
    "last_name": "Rivera",
    "qr_token": "LC1.xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2026-07-19T00:32:00.000Z"
  },
  "token": "eyJhbGciOi..."
}
```

`qr_token` is what the customer app encodes into the QR code shown on
screen — **encode this exact string, not the customer's `id`.**

**Errors:**
| Status | Body | Meaning |
|---|---|---|
| `400` | `{"error": "phone is required"}` | Missing phone |
| `400` | `{"error": "phone must be SMS-verified before registration (stub check)"}` | `smsVerified` missing/false |
| `409` | `{"error": "A customer already exists with that phone or email"}` | Duplicate — should log in instead |

---

### `POST /customer/login`

Same temporary `smsVerified` caveat as register.

**Request body:**

```json
{ "phone": "+15195551234", "smsVerified": true }
```

**Success — `200`:** `{ "token": "eyJhbGciOi..." }`

**Errors:**
| Status | Body |
|---|---|
| `400` | `{"error": "phone and a verified SMS code are required"}` |
| `404` | `{"error": "No account with that phone number"}` |

---

### `GET /customer/me`

**Auth: `customer`.**

**Success — `200`:**

```json
{
  "customer": {
    "id": "uuid",
    "phone": "+15195551234",
    "email": "alex@example.com",
    "first_name": "Alex",
    "last_name": "Rivera",
    "qr_token": "LC1.xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2026-07-19T00:32:00.000Z"
  }
}
```

Use this to render the "My QR Code" screen and profile.

---

### `GET /customer/balances`

**Auth: `customer`.** Per-business point balances, for the home screen.

**Success — `200`:**

```json
{
  "balances": [
    {
      "business_id": "uuid",
      "business_name": "Cactus Coffee Co",
      "points_balance": 42
    }
  ]
}
```

Empty array `[]` if the customer hasn't earned anywhere yet — render an
empty state, not an error.

---

### `GET /customer/history`

**Auth: `customer`.** Combined earn + redeem activity feed, newest first,
capped at 100 rows.

**Success — `200`:**

```json
{
  "history": [
    {
      "type": "earn",
      "points": 42,
      "occurred_at": "2026-07-19T00:35:00.000Z",
      "business_name": "Cactus Coffee Co"
    },
    {
      "type": "redeem",
      "points": -20,
      "occurred_at": "2026-07-18T14:00:00.000Z",
      "business_name": "Cactus Coffee Co"
    }
  ]
}
```

Note `points` is negative for redemptions — sign indicates direction, so
the UI can render both from one list without branching on `type` for the
math (though `type` is still there for icon/label purposes).

---

## Loyalty Endpoints (business-device authenticated)

### `POST /loyalty/scan`

**Auth: `business_device`.** Looks up a customer by QR payload or typed
phone number — this is the single endpoint behind both entry modes on the
counter screen.

**Request body (QR mode):** `{ "qrToken": "LC1.xxxxxxxxxxxxxxxxxxxxxxxxxxxx" }`
**Request body (manual mode):** `{ "phone": "+15195551234" }`

**Success — `200`:**

```json
{
  "customer": {
    "id": "uuid",
    "first_name": "Alex",
    "last_name": "Rivera",
    "phone": "+15195551234",
    "qr_token": "LC1.xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

Show this customer's name on a confirmation screen before calling
`/claim` — don't auto-claim immediately on scan, let staff confirm first.

**Errors:**
| Status | Body |
|---|---|
| `400` | `{"error": "Provide either qrToken or phone"}` |
| `404` | `{"error": "No customer found for that code or phone number"}` |

---

### `POST /loyalty/claim`

**Auth: `business_device`.** The core rules engine. `businessId` is taken
from the authenticated device's token, not from the request body — the
frontend never sends it here.

**Request body:** `{ "customerId": "uuid" }` (the `id` from the `/scan`
response above)

**Success — `201`:**

```json
{
  "claimed": true,
  "pointsEarned": 42,
  "earnedAt": "2026-07-19T00:35:00.000Z",
  "purchaseAmountCents": 4250
}
```

**Success (retry/idempotent replay) — `200`:**

```json
{
  "claimed": true,
  "alreadyProcessed": true,
  "points_earned": 42,
  "earned_at": "2026-07-19T00:35:00.000Z"
}
```

This happens if the exact same claim is submitted twice (e.g. a network
retry after a timeout) — **treat this as a success, not an error.**

**Errors — these are expected, normal outcomes the UI must handle
gracefully, not bugs to report:**
| Status | Body | Meaning | Suggested UI |
|---|---|---|---|
| `400` | `{"error": "customerId is required"}` | Missing field | (shouldn't happen if scan→claim flow is followed) |
| `404` | `{"error": "No recent unclaimed purchase found at this location in the last 30 minutes."}` | No matching POS transaction | "We don't see a recent purchase — try again after paying, or check the register" |
| `409` | `{"error": "This customer already earned points at this business within the last 24 hours.", "code": "CLAIM_WINDOW_ACTIVE"}` | 24h rule blocked it | "This customer already claimed points here today — come back tomorrow!" (check `code`, not just status, for this specific case) |

---

## Webhook Endpoint (Square-only, not called by frontend)

### `POST /webhooks/square`

Square calls this directly — **no frontend app ever calls this.** Included
for completeness. Verifies HMAC signature, processes `payment.updated`
events, writes to `transactions`. Always responds `200` immediately
regardless of internal processing outcome (per Square's retry semantics).

---

## Planned — not yet implemented

Do not build against these yet; shapes below are provisional and may
change before they ship.

| Endpoint                      | Purpose                                     | Tracking       |
| ----------------------------- | ------------------------------------------- | -------------- |
| `POST /business/login`        | Owner dashboard login                       | Roadmap Step 1 |
| `GET /business/devices`       | List staff devices (owner-only)             | Roadmap Step 1 |
| `PATCH /business/devices/:id` | Deactivate a device                         | Roadmap Step 1 |
| `POST /customer/verify/start` | Send real SMS code                          | Roadmap Step 2 |
| `POST /customer/verify/check` | Confirm SMS code, issue verification ticket | Roadmap Step 2 |
| `POST /business/pos/refresh`  | Manually force a Square token refresh       | Roadmap Step 3 |
| `POST /loyalty/redeem`        | Spend points on a reward                    | Roadmap Step 5 |

---

## Change log

| Date       | Change                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-23 | Initial contract — covers Steps 1–3 (schema, API, Square OAuth+webhook), all verified live against a real Square sandbox account |
