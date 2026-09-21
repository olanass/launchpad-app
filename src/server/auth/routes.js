const express = require('express');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const router = express.Router();

function publicChain(config, appUrl) {
  return {
    networkKey: config.networkKey,
    networkId: config.networkId,
    chainId: config.chainId,
    caip2: config.caip2,
    name: config.name,
    networkType: config.networkType,
    rpcUrl: config.publicRpcUrl,
    explorerUrl: config.explorerUrl,
    nativeCurrency: config.nativeCurrency,
    testnet: config.testnet,
    appUrl
  };
}

router.get('/config', (req, res) => res.json({
  success: true, configured: Boolean(process.env.PRIVY_APP_ID), appId: process.env.PRIVY_APP_ID || null,
  chain: publicChain(chain, `${req.protocol}://${req.get('host')}`),
  networks: [publicChain(chain, `${req.protocol}://${req.get('host')}`)]
}));
// Email-only server calls never established ownership or authenticated a user.
// Embedded wallets are created through the authenticated Privy browser SDK.
for (const endpoint of ['/login-email', '/create-embedded-wallet']) {
  router.post(endpoint, (req, res) => res.status(410).json({ success: false, error: 'Use authenticated wallet login in the browser.' }));
}
module.exports = router;
