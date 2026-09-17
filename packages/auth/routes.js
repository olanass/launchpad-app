const express = require('express');
const router = express.Router();
router.get('/config', (req, res) => res.json({
  success: true, configured: Boolean(process.env.PRIVY_APP_ID), appId: process.env.PRIVY_APP_ID || null,
  chain: { chainId: 4663, name: 'Robinhood Chain', networkType: 'Arbitrum Orbit L2' }
}));
// Email-only server calls never established ownership or authenticated a user.
// Embedded wallets are created through the authenticated Privy browser SDK.
for (const endpoint of ['/login-email', '/create-embedded-wallet']) {
  router.post(endpoint, (req, res) => res.status(410).json({ success: false, error: 'Use authenticated wallet login in the browser.' }));
}
module.exports = router;

