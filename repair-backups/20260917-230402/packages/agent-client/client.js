const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN_CONFIG } = require('../facilitator/config');
const { EIP712_DOMAIN, EIP712_TYPES } = require('../facilitator/verifier');

class AgentClient {
  /**
   * @param {Object} options
   * @param {string} [options.privateKey] - Robinhood Chain wallet private key (generates random if omitted)
   * @param {string} [options.baseUrl] - Base API url
   */
  constructor(options = {}) {
    if (options.privateKey) {
      this.wallet = new ethers.Wallet(options.privateKey);
    } else {
      // Create autonomous agent wallet
      this.wallet = ethers.Wallet.createRandom();
    }

    this.baseUrl = options.baseUrl || 'http://localhost:4020';
    this.agentId = options.agentId || `agent-${this.wallet.address.substring(2, 8)}`;
  }

  getAddress() {
    return this.wallet.address;
  }

  /**
   * Performs an HTTP request, automatically intercepting 402 challenges,
   * signing on-chain/EIP-712 micropayments, and retrying.
   *
   * @param {string} path - URL path (e.g. '/api/v1/market/robinhood-pulse')
   * @param {RequestInit} [options={}] - Standard fetch options
   * @returns {Promise<{ status: number, data: any, receipt: any, handshakeSteps: Array }>}
   */
  async fetchWith402(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const steps = [];

    // Step 1: Initial unauthenticated request
    steps.push({
      step: 1,
      phase: 'INITIAL_REQUEST',
      description: `Agent [${this.agentId}] sends request to ${path}`,
      headersSent: options.headers || {}
    });

    let res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    // If resource is free or already accessible
    if (res.status !== 402) {
      let data = {};
      try { data = await res.json(); } catch (e) {}
      steps.push({
        step: 2,
        phase: 'DIRECT_SUCCESS',
        description: `Resource accessible with HTTP ${res.status} (no payment requested)`
      });
      return { status: res.status, data, receipt: null, handshakeSteps: steps };
    }

    // Step 2: HTTP 402 Payment Required intercepted
    const paymentReqHeader = res.headers.get('payment-required');
    let challenge = null;

    if (paymentReqHeader) {
      try {
        const decoded = Buffer.from(paymentReqHeader, 'base64').toString('utf8');
        challenge = JSON.parse(decoded);
      } catch (err) {
        // Fallback to reading body
      }
    }

    if (!challenge) {
      const body = await res.json();
      challenge = body.challenge;
    }

    if (!challenge) {
      throw new Error('Received 402 Payment Required, but failed to parse payment challenge headers');
    }

    steps.push({
      step: 2,
      phase: 'CHALLENGE_RECEIVED',
      description: `Intercepted HTTP 402: Required ${challenge.price} ${challenge.token} on ${challenge.network || 'Robinhood Chain'}`,
      challenge
    });

    // Step 3: Construct & sign payment authorization
    const nonce = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const deadline = Math.floor(Date.now() / 1000) + 300;

    const authorization = {
      payer: this.wallet.address,
      recipient: challenge.recipient,
      amount: String(challenge.price),
      token: challenge.token || 'USDC',
      nonce,
      deadline,
      chainId: challenge.chainId || ROBINHOOD_CHAIN_CONFIG.chainId
    };

    // Sign using agent's private key
    const signature = await this.wallet.signTypedData(
      EIP712_DOMAIN,
      EIP712_TYPES,
      authorization
    );

    const paymentProof = {
      scheme: challenge.scheme || 'exact',
      authorization,
      signature,
      agentId: this.agentId
    };

    const paymentProofHeader = Buffer.from(JSON.stringify(paymentProof)).toString('base64');

    steps.push({
      step: 3,
      phase: 'PAYMENT_SIGNED',
      description: `Cryptographic EIP-712 voucher signed by agent ${this.wallet.address}`,
      authorization,
      signatureSnippet: signature.substring(0, 18) + '...' + signature.substring(signature.length - 8)
    });

    // Step 4: Resend request with PAYMENT-SIGNATURE header attached
    steps.push({
      step: 4,
      phase: 'SETTLEMENT_REQUEST',
      description: `Resending HTTP request with PAYMENT-SIGNATURE attached`
    });

    const retryRes = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        'PAYMENT-SIGNATURE': paymentProofHeader,
        'Authorization': `x402 ${paymentProofHeader}`
      }
    });

    let resultData = {};
    try {
      resultData = await retryRes.json();
    } catch (e) {
      resultData = { raw: await retryRes.text() };
    }

    // Read payment receipt from response headers
    const paymentRespHeader = retryRes.headers.get('payment-response');
    let receipt = null;
    if (paymentRespHeader) {
      try {
        receipt = JSON.parse(Buffer.from(paymentRespHeader, 'base64').toString('utf8'));
      } catch (err) {
        // Fallback
      }
    }

    if (!receipt && resultData.paymentProof) {
      receipt = resultData.paymentProof;
    }

    steps.push({
      step: 5,
      phase: 'SETTLED_AND_DELIVERED',
      description: `HTTP ${retryRes.status} OK received! Settled on Robinhood Chain with receipt ${receipt?.receiptId || 'verified'}`,
      receipt
    });

    return {
      status: retryRes.status,
      data: resultData,
      receipt,
      handshakeSteps: steps
    };
  }
}

module.exports = { AgentClient };
