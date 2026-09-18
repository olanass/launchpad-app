const express = require('express');

const { ROBINHOOD_CHAIN_CONFIG } = require('../config/chain');
const { AgentClient } = require('./client');

const router = express.Router();
const allowedEndpoints = new Set([
  '/api/v1/market/robinhood-pulse',
  '/api/v1/agent/inference',
  '/api/v1/agent/task-runner'
]);

router.post('/execute', async (req, res) => {
  try {
    if (!ROBINHOOD_CHAIN_CONFIG.demoMode) {
      return res.status(403).json({ error: 'Agent runner is available only in demo mode' });
    }

    const { endpoint = '/api/v1/market/robinhood-pulse', method = 'GET', body = null } = req.body || {};
    if (!allowedEndpoints.has(endpoint) || !['GET', 'POST'].includes(method)) {
      return res.status(400).json({ error: 'Unsupported demo endpoint or method' });
    }

    const agent = new AgentClient({ baseUrl: `http://127.0.0.1:${req.socket.localPort}` });
    const fetchOptions = { method };
    if (body && method === 'POST') fetchOptions.body = JSON.stringify(body);

    const result = await agent.fetchWith402(endpoint, fetchOptions);
    return res.json({ success: true, agentWallet: agent.getAddress(), result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
