import { Client, Environment, WebhooksHelper } from 'square';
import 'dotenv/config';

const ENV = process.env.SQUARE_ENVIRONMENT === 'production'
  ? Environment.Production
  : Environment.Sandbox;

const AUTHORIZE_BASE_URL = process.env.SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com/oauth2/authorize'
  : 'https://connect.squareupsandbox.com/oauth2/authorize';

// Scopes: request only what this integration actually needs.
// MERCHANT_PROFILE_READ -> business name/location for setup.
// ORDERS_READ / PAYMENTS_READ -> to know a purchase happened (Step 3 core use).
// Do NOT request write scopes we don't use - reviewers (and businesses) will
// ask why a loyalty app needs the ability to create/modify their orders.
const OAUTH_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'ORDERS_READ',
  'PAYMENTS_READ',
].join('+');

// A client with no accessToken - only used for the OAuth token endpoints,
// which authenticate with client_id/client_secret in the request body
// instead of a bearer token.
function oauthOnlyClient() {
  return new Client({ environment: ENV });
}

/**
 * Step A of OAuth: build the URL we redirect the business owner to.
 * `state` should be a random, single-use value the caller stores server-side
 * (e.g. tied to the business's session) and checks on callback, to prevent
 * CSRF against the OAuth flow.
 */
export function buildAuthorizationUrl({ businessId, state }) {
  const redirectUri = `${process.env.APP_BASE_URL}/api/business/pos/callback`;
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APPLICATION_ID,
    scope: OAUTH_SCOPES,
    session: 'false',
    state: `${businessId}.${state}`,
    redirect_uri: redirectUri,
  });
  return `${AUTHORIZE_BASE_URL}?${params.toString()}`;
}

/**
 * Step B: exchange the authorization code Square redirected back with for
 * a real access token + refresh token. This is a server-to-server call -
 * the application secret never touches the business app or browser.
 * Returns the ObtainTokenResponse body directly (accessToken, refreshToken,
 * expiresAt, merchantId, ...).
 */
export async function exchangeCodeForToken(code) {
  const { result } = await oauthOnlyClient().oAuthApi.obtainToken({
    clientId: process.env.SQUARE_APPLICATION_ID,
    clientSecret: process.env.SQUARE_APPLICATION_SECRET,
    code,
    grantType: 'authorization_code',
    redirectUri: `${process.env.APP_BASE_URL}/api/business/pos/callback`,
  });
  return result;
}

/** Square access tokens expire (30 days in production) - call this on a
 * schedule (cron) for any business whose pos_token_expires_at is approaching,
 * so a business never silently loses connection mid-week. */
export async function refreshAccessToken(refreshToken) {
  const { result } = await oauthOnlyClient().oAuthApi.obtainToken({
    clientId: process.env.SQUARE_APPLICATION_ID,
    clientSecret: process.env.SQUARE_APPLICATION_SECRET,
    refreshToken,
    grantType: 'refresh_token',
  });
  return result;
}

/** Returns a Square SDK client authenticated as a specific connected business. */
export function clientForBusiness(accessToken) {
  return new Client({ accessToken, environment: ENV });
}

/**
 * Fetches the business's first/primary location id after OAuth completes.
 * We store pos_location_id explicitly because all the Orders/Payments API
 * calls we care about are scoped by location, not just merchant.
 */
export async function fetchPrimaryLocationId(accessToken) {
  const client = clientForBusiness(accessToken);
  const { result } = await client.locationsApi.listLocations();
  const active = result.locations?.find((l) => l.status === 'ACTIVE');
  return active?.id ?? result.locations?.[0]?.id ?? null;
}

/**
 * Verifies an inbound webhook actually came from Square before we trust its
 * contents. Uses the SDK's own WebhooksHelper rather than a hand-rolled HMAC
 * check, since Square maintains this against their exact signing scheme.
 * MUST be run against the raw request body (see server.js - express.raw()
 * is mounted specifically on the webhook route for this reason).
 */
export function verifyWebhookSignature({ signatureHeader, notificationUrl, rawBody }) {
  return WebhooksHelper.isValidWebhookEventSignature(
    rawBody,
    signatureHeader,
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl
  );
}
