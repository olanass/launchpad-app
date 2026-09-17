const express = require('express');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config');
const { verifyPayment } = require('./verifier');
const { settlePayment } = require('./settler');
const { store } = require('./store');

const router = express.Router();

/**
 * GET /facilitator/supported
 * Authoritative endpoint declaring supported networks, tokens, and schemes
 * Equivalent to PayAI's GET /supported
 */
router.get('/supported', (req, res) => {
  res.json({
    protocol: 'x402',
    version: ROBINHOOD_CHAIN_CONFIG.version,
    facilitator: {
      name: 'Robinhood Chain x402 Facilitator',
      address: ROBINHOOD_CHAIN_CONFIG.facilitatorAddress,
      feeBps: ROBINHOOD_CHAIN_CONFIG.facilitatorFeeBps,
      feePercent: `${(ROBINHOOD_CHAIN_CONFIG.facilitatorFeeBps / 100)}%`
    },
    supportedNetworks: [
      {
        id: 'robinhood-chain',
        name: ROBINHOOD_CHAIN_CONFIG.name,
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        caip2: ROBINHOOD_CHAIN_CONFIG.caip2,
        networkType: ROBINHOOD_CHAIN_CONFIG.networkType,
        rpcUrl: ROBINHOOD_CHAIN_CONFIG.rpcUrl,
        explorerUrl: ROBINHOOD_CHAIN_CONFIG.explorerUrl,
        nativeGasToken: ROBINHOOD_CHAIN_CONFIG.nativeCurrency.symbol
      }
    ],
    supportedTokens: Object.values(ROBINHOOD_CHAIN_CONFIG.supportedTokens),
    supportedSchemes: ROBINHOOD_CHAIN_CONFIG.paymentSchemes
  });
});

/**
 * POST /facilitator/verify
 * Validates a signed payment authorization or tx against requirements
 */
router.post('/verify', async (req, res) => {
  try {
    const { paymentProof, requirement } = req.body;
    if (!paymentProof || !requirement) {
      return res.status(400).json({ error: 'paymentProof and requirement objects are required' });
    }

    const result = await verifyPayment(paymentProof, requirement);
    if (!result.valid) {
      return res.status(422).json({
        valid: false,
        error: result.error
      });
    }

    return res.json({
      valid: true,
      payer: result.payer,
      recipient: result.recipient,
      amount: result.amount,
      token: result.token,
      scheme: result.scheme,
      network: 'robinhood-chain',
      chainId: ROBINHOOD_CHAIN_CONFIG.chainId
    });
  } catch (err) {
    res.status(500).json({ error: `Verification failed: ${err.message}` });
  }
});

/**
 * POST /facilitator/settle
 * Verifies payment, executes settlement, records to ledger, returns receipt
 */
router.post('/settle', async (req, res) => {
  try {
    const { paymentProof, requirement, metadata } = req.body;
    if (!paymentProof || !requirement) {
      return res.status(400).json({ error: 'paymentProof and requirement are required' });
    }

    const verifyResult = await verifyPayment(paymentProof, requirement);
    if (!verifyResult.valid) {
      return res.status(422).json({
        settled: false,
        error: verifyResult.error
      });
    }

    const receipt = settlePayment(verifyResult, metadata);
    store.recordReceipt(receipt);

    res.json({
      settled: true,
      receipt
    });
  } catch (err) {
    res.status(500).json({ error: `Settlement failed: ${err.message}` });
  }
});

/**
 * GET /facilitator/receipts/:id
 */
router.get('/receipts/:id', (req, res) => {
  const receipt = store.getReceipt(req.params.id);
  if (!receipt) {
    return res.status(404).json({ error: 'Receipt not found' });
  }
  res.json({ receipt });
});

/**
 * GET /facilitator/analytics
 */
router.get('/analytics', (req, res) => {
  res.json({
    analytics: store.getAnalytics(),
    recentEvents: store.getRecentEvents(15)
  });
});

/**
 * GET /facilitator/merchants
 */
router.get('/merchants', (req, res) => {
  res.json({
    merchants: store.getMerchants()
  });
});

/**
 * POST /facilitator/merchants
 */
router.post('/merchants', (req, res) => {
  const { name, recipient, endpoints } = req.body;
  if (!recipient) {
    return res.status(400).json({ error: 'Merchant recipient payout address is required' });
  }
  const merchant = store.registerMerchant({ name, recipient, endpoints });
  res.status(201).json({ merchant });
});

module.exports = router;
