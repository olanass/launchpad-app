const fs = require('fs');
const path = require('path');

// Load environment variables from .env before any modules are initialized
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        if (process.env[key] === undefined) {
          const value = v.join('=').trim();
          process.env[key] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
        }
      }
    });
  }
} catch (e) {}

const express = require('express');
const cors = require('cors');
const facilitatorRouter = require('./packages/facilitator/facilitator');
const demoApiRouter = require('./packages/demo-api/routes');
const paywallRouter = require('./packages/paywall/routes');
const privyAuthRouter = require('./packages/auth/routes');
const { AgentClient } = require('./packages/agent-client/client');
const { ROBINHOOD_CHAIN_CONFIG } = require('./packages/facilitator/config');

const app = express();
const PORT = process.env.PORT || 4020;

// Enable CORS and expose standard x402 headers
app.use(cors({
  origin: '*',
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'WWW-Authenticate']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Facilitator API
app.use('/facilitator', facilitatorRouter);

// Serve Monetized Demo API
if (ROBINHOOD_CHAIN_CONFIG.demoMode) app.use('/api', demoApiRouter);

// Serve Paywall API (Upload, Create, Gas Estimate, Download)
app.use('/api/paywalls', paywallRouter);

// Serve Privy Auth API
app.use('/api/privy', privyAuthRouter);

// Agent Runner endpoint: Allows autonomous agent test execution
app.post('/agent-runner/execute', async (req, res) => {
  try {
    const { endpoint = '/api/v1/market/robinhood-pulse', method = 'GET', body = null } = req.body || {};
    if (!ROBINHOOD_CHAIN_CONFIG.demoMode) return res.status(403).json({ error: 'Agent runner is available only in demo mode' });
    const allowed = ['/api/v1/market/robinhood-pulse', '/api/v1/agent/inference', '/api/v1/agent/task-runner'];
    if (!allowed.includes(endpoint) || !['GET', 'POST'].includes(method)) return res.status(400).json({ error: 'Unsupported demo endpoint or method' });
    const agent = new AgentClient({ baseUrl: 'http://127.0.0.1:' + req.socket.localPort });

    const fetchOptions = { method };
    if (body && method === 'POST') {
      fetchOptions.body = JSON.stringify(body);
    }

    const result = await agent.fetchWith402(endpoint, fetchOptions);

    res.json({
      success: true,
      agentWallet: agent.getAddress(),
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Serve Static Frontend Assets
const staticOptions = {
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store')
};
app.use(express.static(path.join(__dirname, 'packages', 'public'), staticOptions));
app.use('/p', express.static(path.join(__dirname, 'packages', 'public'), staticOptions));

// SPA Route: Support `/p/:id` (Paywall view) and all other pages
app.use(['/api', '/facilitator', '/agent-runner'], (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.name === 'MulterError' ? 400 : (err.status || 500));
  res.status(status).json({ success: false, error: status >= 500 ? 'The request could not be completed' : err.message });
});
app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'Endpoint not found' });
  res.sendFile(path.join(__dirname, 'packages', 'public', 'index.html'));
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║               x402 PAYWALL PLATFORM ON ROBINHOOD CHAIN                    ║
║         Arbitrum Orbit L2 • Chain ID: ${ROBINHOOD_CHAIN_CONFIG.chainId} • Professional SaaS Rail           ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  🚀 Server Online:         http://localhost:${PORT}                           ║
║  🔒 Create Paywall:        http://localhost:${PORT}                           ║
║  ⛽ Real Gas Estimator:    http://localhost:${PORT}/api/paywalls/gas-estimate ║
║  🌐 Facilitator Specs:     http://localhost:${PORT}/facilitator/supported     ║
║  🔗 Explorer:              ${ROBINHOOD_CHAIN_CONFIG.explorerUrl}    ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
