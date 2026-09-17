const { ROBINHOOD_CHAIN_CONFIG } = require('../facilitator/config');
const { verifyPayment } = require('../facilitator/verifier');
const { settlePayment } = require('../facilitator/settler');
const { store } = require('../facilitator/store');

/**
 * Creates an x402 HTTP middleware to protect an Express/Connect route
 * @param {Object} options
 * @param {string} options.price - Amount required (e.g. '0.005')
 * @param {string} [options.token='USDC'] - Token symbol
 * @param {string} options.recipient - Merchant payout address on Robinhood Chain
 * @param {string} [options.scheme='exact'] - Payment scheme ('exact', 'sandbox', 'onchain-tx')
 * @param {string} [options.facilitatorUrl] - Public facilitator URL
 * @returns {Function} Express middleware (req, res, next)
 */
function x402(options = {}) {
  const {
    price,
    token = 'USDC',
    recipient,
    scheme = 'exact',
    facilitatorUrl = '/facilitator'
  } = options;

  if (!price || !recipient) {
    throw new Error('x402 middleware requires both "price" and "recipient" options');
  }

  return async function x402Middleware(req, res, next) {
    // 1. Check for payment header in multiple standard formats
    const paymentSigHeader = req.headers['payment-signature'] || req.headers['x402-payment'];
    const authHeader = req.headers['authorization'];

    let rawPaymentProof = null;

    if (paymentSigHeader) {
      rawPaymentProof = paymentSigHeader;
    } else if (authHeader && authHeader.startsWith('x402 ')) {
      rawPaymentProof = authHeader.substring(5).trim();
    }

    const requirement = {
      price: String(price),
      token,
      network: 'robinhood-chain',
      chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
      caip2: ROBINHOOD_CHAIN_CONFIG.caip2,
      recipient,
      scheme,
      facilitatorUrl,
      timeoutSeconds: 300,
      expiresAt: Math.floor(Date.now() / 1000) + 300
    };

    // 2. If no payment proof provided, respond with HTTP 402 Payment Required
    if (!rawPaymentProof) {
      const challengeJson = JSON.stringify(requirement);
      const challengeBase64 = Buffer.from(challengeJson).toString('base64');

      res.status(402);
      res.set({
        'WWW-Authenticate': 'x402',
        'PAYMENT-REQUIRED': challengeBase64,
        'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, WWW-Authenticate'
      });

      return res.json({
        statusCode: 402,
        error: 'Payment Required',
        message: `This resource requires an x402 micropayment of ${price} ${token} on Robinhood Chain.`,
        challenge: requirement
      });
    }

    // 3. Parse payment proof
    let paymentProof;
    try {
      if (typeof rawPaymentProof === 'string') {
        if (rawPaymentProof.startsWith('{')) {
          paymentProof = JSON.parse(rawPaymentProof);
        } else {
          // Attempt base64 decode
          const decoded = Buffer.from(rawPaymentProof, 'base64').toString('utf8');
          paymentProof = JSON.parse(decoded);
        }
      } else {
        paymentProof = rawPaymentProof;
      }
    } catch (err) {
      return res.status(400).json({
        error: 'Invalid payment proof format',
        details: 'Failed to decode PAYMENT-SIGNATURE header'
      });
    }

    // 4. Verify and Settle Payment via Facilitator
    try {
      const verifyResult = await verifyPayment(paymentProof, requirement);
      if (!verifyResult.valid) {
        res.status(402);
        res.set({
          'WWW-Authenticate': 'x402 error="invalid_payment"',
          'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(requirement)).toString('base64')
        });
        return res.json({
          statusCode: 402,
          error: 'Payment Verification Failed',
          details: verifyResult.error
        });
      }

      // Settle and issue receipt
      const receipt = settlePayment(verifyResult, {
        endpoint: req.originalUrl || req.path,
        method: req.method,
        clientIp: req.ip
      });

      // Record to store
      store.recordReceipt(receipt);

      // Attach receipt to response headers and request object
      const receiptJson = JSON.stringify(receipt);
      const receiptBase64 = Buffer.from(receiptJson).toString('base64');

      res.set({
        'PAYMENT-RESPONSE': receiptBase64,
        'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, WWW-Authenticate'
      });

      req.x402 = {
        receipt,
        payer: verifyResult.payer,
        amount: verifyResult.amount,
        token: verifyResult.token
      };

      // Proceed to actual handler
      next();
    } catch (err) {
      res.status(500).json({
        error: 'Facilitator Settlement Error',
        details: err.message
      });
    }
  };
}

module.exports = { x402 };
