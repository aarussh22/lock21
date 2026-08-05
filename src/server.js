import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { businessRouter } from './routes/business.js';
import { customerRouter } from './routes/customer.js';
import { loyaltyRouter } from './routes/loyalty.js';
import { squareOAuthRouter } from './routes/square-oauth.js';
import { squareWebhookRouter } from './routes/square-webhook.js';
import { authRouter } from './routes/auth.js';
import { qrRouter } from './routes/qr.js';

const app = express();

app.use(cors());

// The Square webhook route needs the RAW body for signature verification,
// so it's mounted with express.raw() BEFORE the global express.json()
// middleware below. Order matters here - if json() ran first, req.body
// would already be a parsed object and the raw bytes needed for the
// signature check would be lost.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), squareWebhookRouter);

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/business', businessRouter);
app.use('/api/business', squareOAuthRouter); // adds /pos/connect and /pos/callback under /api/business
app.use('/api/customer', customerRouter);
app.use('/api/loyalty', loyaltyRouter);
// Mounted at ROOT, not under /api - matches Config.apiBaseURL in the iOS
// app, which has no /api segment and calls "/auth/send-code", "/qr/token"
// as literal top-level paths.
app.use('/auth', authRouter);
app.use('/qr', qrRouter);

// Add a temporary health endpoint
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is reachable"
  });
});


// Centralized error handler - catches anything thrown/rejected in a route
// that wasn't already handled with its own try/catch.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

const port = process.env.PORT ?? 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Loyalty backend listening on port ${port}`);
});


// --- Process-level safety net (defense in depth) ---
// Every route handler is now wrapped in asyncHandler (src/utils/asyncHandler.js),
// which forwards errors to the centralized handler above - that covers the
// vast majority of real-world crashes (bad input, DB errors, etc). These two
// listeners are a last resort for anything that happens truly outside an
// Express request (a stray unhandled promise somewhere, a bug in a library).
// They log loudly instead of silently swallowing the problem, but
// deliberately do NOT exit the process - keeping the server up and
// responsive to other in-flight requests is more valuable during
// development/demo than a "correct" crash-and-restart, which is what Node
// would otherwise do by default on an unhandled rejection.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION (server stayed up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION (server stayed up):', err);
});

