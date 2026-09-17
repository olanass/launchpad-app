const { ethers } = require('ethers');
const crypto = require('crypto');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config');

/**
 * Settle verified payment and generate standard x402 receipt
 * @param {Object} verifiedData - Output from verifyPayment
 * @param {Object} [metadata] - Additional context (endpoint, resource, agentId)
 * @returns {Object} Standard x402 Payment Receipt
 */
function settlePayment(verifiedData, metadata = {}) {
  const receiptId = 'rcpt_rh_' + crypto.randomBytes(8).toString('hex');
  const settledAt = new Date().toISOString();

  // Fee calculation (0.5% facilitator fee)
  const amountNum = parseFloat(verifiedData.amount);
  const feeRate = ROBINHOOD_CHAIN_CONFIG.facilitatorFeeBps / 10000;
  const facilitatorFee = (amountNum * feeRate).toFixed(6);
  const merchantPayout = (amountNum - parseFloat(facilitatorFee)).toFixed(6);

  // Simulated or real transaction hash on Robinhood Chain
  const txHash = verifiedData.txHash || ('0x' + crypto.randomBytes(32).toString('hex'));

  const receipt = {
    receiptId,
    status: 'settled',
    network: 'robinhood-chain',
    chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
    caip2: ROBINHOOD_CHAIN_CONFIG.caip2,
    token: verifiedData.token || 'USDC',
    amount: verifiedData.amount,
    facilitatorFee,
    merchantPayout,
    payer: verifiedData.payer,
    recipient: verifiedData.recipient,
    settlementType: verifiedData.scheme === 'onchain-tx' ? 'onchain-mined' : 'facilitator-cleared',
    txHash,
    settledAt,
    explorerLink: `${ROBINHOOD_CHAIN_CONFIG.explorerUrl}/tx/${txHash}`,
    metadata: {
      endpoint: metadata.endpoint || '/api/resource',
      agentId: metadata.agentId || 'agent-4663',
      ...metadata
    }
  };

  return receipt;
}

module.exports = { settlePayment };
