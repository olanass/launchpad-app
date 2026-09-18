const express = require('express');
const { NETWORKS, ROBINHOOD_CHAIN_CONFIG: chain, getRobinhoodChainConfig } = require('../config/chain');
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

function configuredAppUrl(req, networkKey) {
  if (networkKey === chain.networkKey) return `${req.protocol}://${req.get('host')}`;
  const configured = process.env[`ROBINHOOD_${networkKey.toUpperCase()}_APP_URL`];
  if (configured) return configured.replace(/\/$/, '');

  // Convenient defaults for the local dual-network launcher. Public deployments
  // must explicitly configure the URL of their other isolated network instance.
  const hostname = req.hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') return null;
  const port = process.env[`ROBINHOOD_${networkKey.toUpperCase()}_PORT`] || (networkKey === 'mainnet' ? '4020' : '4021');
  return `${req.protocol}://${hostname}:${port}`;
}

router.get('/config', (req, res) => res.json({
  success: true, configured: Boolean(process.env.PRIVY_APP_ID), appId: process.env.PRIVY_APP_ID || null,
  chain: publicChain(chain, configuredAppUrl(req, chain.networkKey)),
  networks: Object.keys(NETWORKS).map(networkKey => {
    const config = getRobinhoodChainConfig(networkKey);
    return publicChain(config, configuredAppUrl(req, networkKey));
  })
}));
// Email-only server calls never established ownership or authenticated a user.
// Embedded wallets are created through the authenticated Privy browser SDK.
for (const endpoint of ['/login-email', '/create-embedded-wallet']) {
  router.post(endpoint, (req, res) => res.status(410).json({ success: false, error: 'Use authenticated wallet login in the browser.' }));
}
module.exports = router;

