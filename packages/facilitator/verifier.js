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
  return new ethers.JsonRpcProvider(request, config.chainId, { staticNetwork: true });
}

async function fetchRpcPayment(txHash) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [txHash] },
        { jsonrpc: '2.0', id: 3, method: 'eth_getTransactionByHash', params: [txHash] }
      ]),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('RPC request failed');
    const replies = await response.json();
    if (!Array.isArray(replies)) throw new Error('RPC returned an invalid response');
    const result = id => {
      const reply = replies.find(item => item.id === id);
      if (!reply || reply.error) throw new Error(reply?.error?.message || 'RPC response is incomplete');
      return reply.result;
    };
    if (Number(BigInt(result(1))) !== config.chainId) throw new Error('RPC chain mismatch');
    const rawReceipt = result(2);
    const rawTx = result(3);
    if (!rawReceipt || !rawTx) throw new Error('Transaction pending or not found');
    return {
      receipt: {
        status: Number(BigInt(rawReceipt.status)),
        hash: rawReceipt.transactionHash,
        blockNumber: rawReceipt.blockNumber == null ? null : Number(BigInt(rawReceipt.blockNumber)),
        logs: rawReceipt.logs || []
      },
      tx: {
        hash: rawTx.hash,
        from: rawTx.from,
        to: rawTx.to,
        value: BigInt(rawTx.value || '0x0')
      }
    };
  } finally { clearTimeout(timer); }
}

async function checkChainReadiness() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }
      ]),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('RPC readiness request failed');
    const replies = await response.json();
    if (!Array.isArray(replies)) throw new Error('RPC returned an invalid response');
    const value = id => {
      const reply = replies.find(item => item.id === id);
      if (!reply || reply.error || reply.result == null) throw new Error('RPC readiness response is incomplete');
      return reply.result;
    };
    const chainId = Number(BigInt(value(1)));
    const blockNumber = Number(BigInt(value(2)));
    if (chainId !== config.chainId || !Number.isSafeInteger(blockNumber)) throw new Error('RPC returned the wrong network');
    return { chainId, blockNumber };
  } finally { clearTimeout(timer); }
}

async function fetchExplorerPayment(txHash) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${config.explorerUrl}/api/v2/transactions/${txHash}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Transaction pending or not found');
    const transaction = await response.json();
    if (transaction.status === 'error') throw new Error('Transaction reverted');
    if (transaction.status !== 'ok' || transaction.block_number == null) throw new Error('Transaction pending or not found');
    return {
      receipt: {
        status: 1,
        hash: transaction.hash,
        blockNumber: Number(transaction.block_number),
        logs: []
      },
      tx: {
        hash: transaction.hash,
        from: transaction.from?.hash,
        to: transaction.to?.hash,
        value: BigInt(transaction.value || '0')
      }
    };
  } finally { clearTimeout(timer); }
}

async function fastPaymentLookup(txHash, token) {
  const lookups = [fetchRpcPayment(txHash)];
  // Blockscout fully exposes native transfers and is usually the first indexer
  // to observe them. Token transfers still use receipt logs from the RPC.
  if (token === 'ETH') lookups.push(fetchExplorerPayment(txHash));
  try { return await Promise.any(lookups); }
  catch (err) {
    const failures = err?.errors || [];
    const reverted = failures.find(failure => failure?.message === 'Transaction reverted');
    throw reverted || new Error('Transaction pending or not found');
  }
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
    // The transaction itself is signed by the payer. A separate personal_sign
    // prompt adds no payment validation and forced buyers through a confusing
    // second wallet confirmation after their transfer was already confirmed.
    if (proof.signature && ethers.verifyMessage(claimMessage(proof.txHash, payer, requirement.resource), proof.signature) !== payer) throw new Error('Invalid payer claim signature');
    const redemptionKey = 'tx:' + config.chainId + ':' + proof.txHash.toLowerCase();
    const existingReceipt = getRedemption(redemptionKey);
    if (existingReceipt) {
      if (existingReceipt.payer !== payer || existingReceipt.recipient !== recipient || existingReceipt.token !== token || parseAmount(existingReceipt.amount, token) !== required || existingReceipt.metadata?.endpoint !== requirement.resource) throw new Error('Payment has already been redeemed for another requirement');
      return { valid: true, payer, recipient, amount: requirement.price, token, scheme: 'onchain-tx', txHash: proof.txHash, redemptionKey, existingReceipt };
    }
    let receipt;
    let tx;
    if (options.provider) {
      provider = options.provider;
      if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw new Error('RPC chain mismatch');
      [receipt, tx] = await Promise.all([provider.getTransactionReceipt(proof.txHash), provider.getTransaction(proof.txHash)]);
    } else {
      ({ receipt, tx } = await fastPaymentLookup(proof.txHash, token));
    }
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
module.exports = { EIP712_DOMAIN, EIP712_TYPES, verifyPayment, claimMessage, createProvider, checkChainReadiness };
