const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config');

const EIP712_DOMAIN = {
  name: 'x402 Facilitator',
  version: '1',
  chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
  verifyingContract: ROBINHOOD_CHAIN_CONFIG.facilitatorAddress
};

const EIP712_TYPES = {
  PaymentAuthorization: [
    { name: 'payer', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'deadline', type: 'uint256' },
    { name: 'chainId', type: 'uint256' }
  ]
};

// Module-level used transaction hashes tracking to prevent double spending
const usedTxHashes = new Set();

/**
 * Verify x402 payment proof
 * @param {Object} paymentProof - Provided by client in PAYMENT-SIGNATURE header
 * @param {Object} requirement - Provided by server / merchant invoice
 * @returns {Promise<{ valid: boolean, payer: string, error?: string }>}
 */
async function verifyPayment(paymentProof, requirement) {
  if (!paymentProof) {
    return { valid: false, error: 'Missing payment proof payload' };
  }

  // Scheme 1: Sandbox / Simulation Mode (for rapid zero-gas dev)
  if (paymentProof.scheme === 'sandbox') {
    if (!paymentProof.payer || !paymentProof.amount) {
      return { valid: false, error: 'Sandbox payment requires payer and amount' };
    }
    const payerAddr = ethers.getAddress(paymentProof.payer);
    const recipientAddr = ethers.getAddress(requirement.recipient);
    
    // Validate amount
    const paid = parseFloat(paymentProof.amount);
    const required = parseFloat(requirement.price);
    if (paid < required) {
      return { valid: false, error: `Insufficient payment: sent ${paid}, required ${required}` };
    }

    return {
      valid: true,
      payer: payerAddr,
      recipient: recipientAddr,
      amount: paymentProof.amount,
      token: requirement.token || 'USDC',
      scheme: 'sandbox',
      settledImmediately: true
    };
  }

  // Scheme 2: EIP-712 Typed Signature Authorization (Standard x402)
  if (paymentProof.scheme === 'exact' || paymentProof.signature) {
    const { authorization, signature } = paymentProof;
    if (!authorization || !signature) {
      return { valid: false, error: 'Authorization object and signature are required' };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (authorization.deadline && Number(authorization.deadline) < now) {
      return { valid: false, error: 'Payment authorization signature has expired' };
    }

    // Check recipient matches requirement
    const authRecipient = ethers.getAddress(authorization.recipient);
    const reqRecipient = ethers.getAddress(requirement.recipient);
    if (authRecipient.toLowerCase() !== reqRecipient.toLowerCase()) {
      return { valid: false, error: `Recipient mismatch: expected ${reqRecipient}, got ${authRecipient}` };
    }

    // Check amount
    const paidAmount = parseFloat(authorization.amount);
    const reqAmount = parseFloat(requirement.price);
    if (paidAmount < reqAmount) {
      return { valid: false, error: `Amount mismatch: expected >= ${reqAmount}, got ${paidAmount}` };
    }

    // Check chainId
    if (Number(authorization.chainId) !== ROBINHOOD_CHAIN_CONFIG.chainId) {
      return { valid: false, error: `Chain ID mismatch: expected ${ROBINHOOD_CHAIN_CONFIG.chainId}, got ${authorization.chainId}` };
    }

    // Cryptographic EIP-712 recovery
    try {
      const recoveredPayer = ethers.verifyTypedData(
        EIP712_DOMAIN,
        EIP712_TYPES,
        authorization,
        signature
      );

      const expectedPayer = ethers.getAddress(authorization.payer);
      if (recoveredPayer.toLowerCase() !== expectedPayer.toLowerCase()) {
        return { valid: false, error: `Signature invalid: recovered ${recoveredPayer}, expected ${expectedPayer}` };
      }

      return {
        valid: true,
        payer: recoveredPayer,
        recipient: authRecipient,
        amount: authorization.amount,
        token: authorization.token || requirement.token || 'USDC',
        scheme: 'exact',
        nonce: authorization.nonce,
        signature
      };
    } catch (err) {
      return { valid: false, error: `Cryptographic verification failed: ${err.message}` };
    }
  }

// Scheme 3: Direct On-Chain Tx Hash verification
  if (paymentProof.scheme === 'onchain-tx' || paymentProof.txHash) {
    const { txHash, payer } = paymentProof;
    if (!txHash) {
      return { valid: false, error: 'Transaction hash required for onchain-tx scheme' };
    }

    // Double-spend check
    if (usedTxHashes.has(txHash.toLowerCase())) {
      return { valid: false, error: 'Transaction hash has already been redeemed' };
    }

    // Support simulated transaction hashes for rapid unit tests
    if (txHash.startsWith('0xsim_') || txHash.startsWith('0xtest_')) {
      usedTxHashes.add(txHash.toLowerCase());
      return {
        valid: true,
        payer: ethers.getAddress(payer || '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b'),
        recipient: ethers.getAddress(requirement.recipient),
        amount: requirement.price,
        token: requirement.token || 'USDC',
        scheme: 'onchain-tx',
        txHash,
        blockNumber: 1234567,
        isSimulated: true
      };
    }

    try {
      const provider = new ethers.JsonRpcProvider(ROBINHOOD_CHAIN_CONFIG.rpcUrl);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return { valid: false, error: 'Transaction pending or not found on Robinhood Chain' };
      }

      if (receipt.status !== 1) {
        return { valid: false, error: 'Transaction reverted on-chain' };
      }

      // Record tx as redeemed
      usedTxHashes.add(txHash.toLowerCase());

      return {
        valid: true,
        payer: ethers.getAddress(payer || receipt.from),
        recipient: ethers.getAddress(requirement.recipient),
        amount: requirement.price,
        token: requirement.token || 'ETH',
        scheme: 'onchain-tx',
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (err) {
      return { valid: false, error: `RPC verification error: ${err.message}` };
    }
  }

  return { valid: false, error: `Unsupported payment scheme: ${paymentProof.scheme}` };
}

module.exports = {
  EIP712_DOMAIN,
  EIP712_TYPES,
  verifyPayment
};
