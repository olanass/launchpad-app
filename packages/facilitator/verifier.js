const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN_CONFIG: config } = require('./config');
const { parseAmount } = require('./amount');
const { isRedeemed, getRedemption } = require('./redemptions');
const EIP712_DOMAIN = { name: 'x402 Facilitator', version: '1', chainId: config.chainId, verifyingContract: config.facilitatorAddress };
const EIP712_TYPES = { PaymentAuthorization: [
  { name: 'payer', type: 'address' }, { name: 'recipient', type: 'address' },
  { name: 'amount', type: 'string' }, { name: 'token', type: 'string' },
  { name: 'nonce', type: 'string' }, { name: 'deadline', type: 'uint256' },
  { name: 'chainId', type: 'uint256' }
] };
function claimMessage(txHash, payer, resource) {
  return 'x402 download\nChain: ' + config.chainId + '\nTransaction: ' + txHash.toLowerCase() + '\nResource: ' + resource + '\nPayer: ' + payer.toLowerCase();
}
function createProvider() {
  const request = new ethers.FetchRequest(config.rpcUrl);
  request.timeout = 8000;
  return new ethers.JsonRpcProvider(request);
}
async function verifyPayment(proof, requirement, options = {}) {
  let provider;
  try {
    if (!proof || typeof proof !== 'object' || !requirement) throw new Error('Payment proof and requirement are required');
    const token = requirement.token || 'USDC';
    const required = parseAmount(requirement.price, token);
    const recipient = ethers.getAddress(requirement.recipient.toLowerCase());
    if (proof.scheme === 'sandbox' || proof.scheme === 'exact') {
      if (!config.demoMode) throw new Error('Simulated payments and unsigned settlement vouchers are disabled');
      const auth = proof.scheme === 'exact' ? proof.authorization : proof;
      if (!auth) throw new Error('Missing authorization');
      const payer = ethers.getAddress(auth.payer.toLowerCase());
      if (auth.token !== token || Number(auth.chainId) !== config.chainId) throw new Error('Token or chain mismatch');
      if (ethers.getAddress(auth.recipient.toLowerCase()) !== recipient) throw new Error('Recipient mismatch');
      if (parseAmount(auth.amount, token) < required) throw new Error('Insufficient payment');
      if (!auth.nonce || typeof auth.nonce !== 'string' || auth.nonce.length > 128) throw new Error('Payment nonce is required');
      if (proof.scheme === 'exact') {
        if (!Number.isSafeInteger(auth.deadline) || auth.deadline <= Date.now() / 1000) throw new Error('Authorization expired');
        if (ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, auth, proof.signature) !== payer) throw new Error('Invalid signature');
      }
      const redemptionKey = 'demo:' + payer.toLowerCase() + ':' + auth.nonce;
      if (isRedeemed(redemptionKey)) throw new Error('Payment has already been redeemed');
      return { valid: true, payer, recipient, amount: auth.amount, token, scheme: proof.scheme, isSimulated: true, redemptionKey };
    }
    if (proof.scheme !== 'onchain-tx') throw new Error('Unsupported payment scheme');
    if (!/^0x[0-9a-fA-F]{64}$/.test(proof.txHash || '')) throw new Error('Invalid transaction hash');
    const payer = ethers.getAddress(proof.payer);
    if (typeof requirement.resource !== 'string' || !requirement.resource.startsWith('/')) throw new Error('Payment resource is required');
    if (ethers.verifyMessage(claimMessage(proof.txHash, payer, requirement.resource), proof.signature) !== payer) throw new Error('Invalid payer claim signature');
    const redemptionKey = 'tx:' + config.chainId + ':' + proof.txHash.toLowerCase();
    const existingReceipt = getRedemption(redemptionKey);
    if (existingReceipt) {
      if (existingReceipt.payer !== payer || existingReceipt.recipient !== recipient || existingReceipt.token !== token || parseAmount(existingReceipt.amount, token) !== required || existingReceipt.metadata?.endpoint !== requirement.resource) throw new Error('Payment has already been redeemed for another requirement');
      return { valid: true, payer, recipient, amount: requirement.price, token, scheme: 'onchain-tx', txHash: proof.txHash, redemptionKey, existingReceipt };
    }
    provider = options.provider || createProvider();
    if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw new Error('RPC chain mismatch');
    const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(proof.txHash), provider.getTransaction(proof.txHash)]);
    if (!receipt || !tx) throw new Error('Transaction pending or not found');
    if (receipt.status !== 1) throw new Error('Transaction reverted');
    if (receipt.hash.toLowerCase() !== proof.txHash.toLowerCase() || tx.hash.toLowerCase() !== proof.txHash.toLowerCase()) throw new Error('Transaction hash mismatch');
    if (ethers.getAddress(tx.from) !== payer) throw new Error('Transaction payer mismatch');
    if (receipt.blockNumber == null) throw new Error('Transaction pending or not found');
    if (token === 'ETH') {
      if (!tx.to || ethers.getAddress(tx.to) !== recipient || tx.value < required) throw new Error('Recipient or amount mismatch');
    } else {
      const contract = config.supportedTokens[token].address;
      const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
      let received = 0n;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
        try {
          const event = iface.parseLog(log);
          if (event?.name === 'Transfer' && event.args.from === payer && event.args.to === recipient) received += event.args.value;
        } catch (_) { /* Ignore unrelated events. */ }
      }
      if (received < required) throw new Error('Token transfer amount or recipient mismatch');
    }
    return { valid: true, payer, recipient, amount: requirement.price, token, scheme: 'onchain-tx', txHash: proof.txHash, blockNumber: receipt.blockNumber, redemptionKey };
  } catch (err) { return { valid: false, error: err.message }; }
  finally { if (provider && !options.provider) provider.destroy(); }
}
module.exports = { EIP712_DOMAIN, EIP712_TYPES, verifyPayment, claimMessage, createProvider };

