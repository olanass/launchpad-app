const path = require('path');
const express = require('express');
const cors = require('cors');

const agentRouter = require('./agent/routes');
const privyAuthRouter = require('./auth/routes');
const { CLIENT_DIR } = require('./config/paths');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config/chain');
const demoApiRouter = require('./demo/routes');
const facilitatorRouter = require('./facilitator/facilitator');
const paywallRouter = require('./paywall/routes');

const app = express();

app.use(cors({
  origin: '*',
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'WWW-Authenticate']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/facilitator', facilitatorRouter);
if (ROBINHOOD_CHAIN_CONFIG.demoMode) app.use('/api', demoApiRouter);
app.use('/api/paywalls', paywallRouter);
app.use('/api/privy', privyAuthRouter);
app.use('/agent-runner', agentRouter);

const staticOptions = {
  etag: false,
  setHeaders: response => response.setHeader('Cache-Control', 'no-store')
};
app.use(express.static(CLIENT_DIR, staticOptions));
app.use('/p', express.static(CLIENT_DIR, staticOptions));

app.use(['/api', '/facilitator', '/agent-runner'], (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE'
    ? 413
    : (error.name === 'MulterError' ? 400 : (error.status || 500));
  return res.status(status).json({
    success: false,
    error: status >= 500 ? 'The request could not be completed' : error.message
  });
});

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  return res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

module.exports = app;
