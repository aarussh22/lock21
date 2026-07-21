import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { businessRouter } from './routes/business.js';
import { customerRouter } from './routes/customer.js';
import { loyaltyRouter } from './routes/loyalty.js';
import { squareOAuthRouter } from './routes/square-oauth.js';
import { squareWebhookRouter } from './routes/square-webhook.js';

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

// Centralized error handler - catches anything thrown/rejected in a route
// that wasn't already handled with its own try/catch.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`Loyalty backend listening on http://localhost:${port}`);
});
