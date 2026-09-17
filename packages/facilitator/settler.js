const crypto = require('crypto');
const { ROBINHOOD_CHAIN_CONFIG: config } = require('./config');
const { redeem, getRedemption } = require('./redemptions');
function settlePayment(data, metadata = {}) {
  if (!data?.valid || (!data.isSimulated && !data.txHash)) throw new Error('Confirmed payment required');
  if (data.existingReceipt) return { ...data.existingReceipt, replayed: true };
  const receipt = {
    receiptId: 'rcpt_rh_' + crypto.randomBytes(8).toString('hex'),
    status: data.isSimulated ? 'simulated' : 'settled', isSimulated: Boolean(data.isSimulated),
    network: 'robinhood-chain', chainId: config.chainId, caip2: config.caip2,
    token: data.token, amount: data.amount, facilitatorFee: '0', merchantPayout: data.amount,
    payer: data.payer, recipient: data.recipient,
    settlementType: data.isSimulated ? 'simulation' : 'onchain-mined',
    txHash: data.txHash || null, settledAt: new Date().toISOString(),
    explorerLink: data.txHash ? config.explorerUrl + '/tx/' + data.txHash : null, metadata
  };
  try { redeem(data.redemptionKey, receipt); }
  catch (err) {
    const previous = getRedemption(data.redemptionKey);
    if (!data.isSimulated && previous && previous.payer === receipt.payer && previous.recipient === receipt.recipient && previous.token === receipt.token && previous.amount === receipt.amount && previous.metadata?.endpoint === receipt.metadata?.endpoint) return { ...previous, replayed: true };
    throw err;
  }
  return receipt;
}
module.exports = { settlePayment };

