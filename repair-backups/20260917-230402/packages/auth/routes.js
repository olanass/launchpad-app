const express = require('express');
const { getOrCreateEmailWallet, createEmbeddedWallet, getPrivyClient } = require('./privy');

const router = express.Router();

/**
 * GET /api/privy/config
 * Returns configured Privy App ID and status
 */
router.get('/config', (req, res) => {
  const appId = process.env.PRIVY_APP_ID;
  const isConfigured = Boolean(appId && process.env.PRIVY_APP_SECRET);

  res.json({
    success: true,
    configured: isConfigured,
    appId: appId || null,
    chain: {
      chainId: 4663,
      name: 'Robinhood Chain',
      networkType: 'Arbitrum Orbit L2'
    }
  });
});

/**
 * POST /api/privy/login-email
 * Creates or retrieves real EVM wallet for email user via Privy
 */
router.post('/login-email', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email address is required' });
    }

    const walletRecord = await getOrCreateEmailWallet(email);

    res.json({
      success: true,
      user: {
        email: walletRecord.email,
        walletAddress: walletRecord.address,
        walletId: walletRecord.id,
        isNew: walletRecord.isNew,
        authType: 'privy-email',
        chain: 'Robinhood Chain (4663)'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/privy/create-embedded-wallet
 * Creates a brand new embedded EVM wallet via Privy API
 */
router.post('/create-embedded-wallet', async (req, res) => {
  try {
    const wallet = await createEmbeddedWallet();

    res.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        chainType: wallet.chainType,
        authType: 'privy-embedded',
        chain: 'Robinhood Chain (4663)'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
