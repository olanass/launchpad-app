const express = require('express');
const cors = require('cors');

const agentRouter = require('./agent/routes');
const privyAuthRouter = require('./auth/routes');
const path = require('path');
const { CLIENT_DIR, GENERATED_DIR } = require('./config/paths');
const CLIENT_INDEX_PATH = path.join(CLIENT_DIR, 'index.html');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config/chain');
const demoApiRouter = require('./demo/routes');
const facilitatorRouter = require('./facilitator/facilitator');
const paywallRouter = require('./paywall/routes');
const { router: mcpRouter } = require('./mcp/routes');
const { publicRouter: serviceRouter, gatewayRouter: serviceGatewayRouter, discoveryHandler } = require('./services/routes');

function createApp({ serveClient = true } = {}) {
const app = express();
app.get('/api/version', (req, res) => res.set('Cache-Control', 'no-store').json({
  application: 'x402-launchpad',
  purchaseFlow: 'durable-orders-v1',
  repository: 'olanass/launchpad-app',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
}));

app.use(cors({
  origin: '*',
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'WWW-Authenticate']
}));
const jsonParser = express.json();
const serviceJsonParser = express.json({ limit: '1mb' });
const urlencodedParser = express.urlencoded({ extended: true });
app.use((req, res, next) => (req.path.startsWith('/x402/') || req.path.startsWith('/api/services')) ? next() : jsonParser(req, res, next));
app.use((req, res, next) => req.path.startsWith('/x402/') ? next() : urlencodedParser(req, res, next));

app.use('/facilitator', facilitatorRouter);
if (ROBINHOOD_CHAIN_CONFIG.demoMode) app.use('/api', demoApiRouter);
app.use('/api/paywalls', paywallRouter);
app.use('/api/services', serviceJsonParser, serviceRouter);
app.use('/api/orders', require('./orders/routes'));
app.use('/api/inference', require('./inference/gateway').router);
app.use('/api/inference/escrow', require('./inference/escrow').createEscrowRouter());
app.get('/discovery/resources', discoveryHandler);
app.use('/x402', serviceGatewayRouter);
app.use('/api/privy', privyAuthRouter);
app.use('/agent-runner', agentRouter);
app.use('/mcp', mcpRouter);
app.get('/llms.txt', (req, res) => res.type('text/plain').sendFile(path.join(GENERATED_DIR, 'llms.txt')));
app.get(/^\/docs\/(.+)\.md$/, (req, res, next) => {
  const relative = String(req.params[0] || '').replace(/\\/g, '/');
  if (!/^[a-z0-9/_-]+$/i.test(relative) || relative.includes('..')) return next();
  const slug = relative === 'home' ? 'index' : relative;
  return res.type('text/markdown').sendFile(slug + '.md', {
    root: path.join(GENERATED_DIR, 'docs-markdown')
  });
});

const staticOptions = {
  etag: false,
  setHeaders: response => response.setHeader('Cache-Control', 'no-store')
};
// Next rewrites browser asset requests here when the client is rendered by the
// App Router. Keep this route available even when the public client fallback is
// disabled (as it is for the custom Next server and the serverless API entry).
app.use('/api/_client', express.static(CLIENT_DIR, staticOptions));
if (serveClient) {
  app.use(express.static(CLIENT_DIR, staticOptions));
  app.use('/p', express.static(CLIENT_DIR, staticOptions));
}

app.use(['/api', '/facilitator', '/agent-runner', '/mcp'], (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'STORAGE_NOT_CONFIGURED'
    ? 503
    : error.code === 'LIMIT_FILE_SIZE'
    ? 413
    : (error.name === 'MulterError' ? 400 : (error.status || 500));
  return res.status(status).json({
    success: false,
    error: error.code === 'STORAGE_NOT_CONFIGURED'
      ? 'The service catalog is temporarily unavailable'
      : (status >= 500 ? 'The request could not be completed' : error.message)
  });
});

if (serveClient) app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  return res.sendFile(CLIENT_INDEX_PATH);
});

return app;
}

const app = createApp();
module.exports = app;
module.exports.createApp = createApp;
