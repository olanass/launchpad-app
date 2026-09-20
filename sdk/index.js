'use strict';

const { ethers } = require('ethers');

const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

function base64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decodeHeader(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); }
  catch (_) { return null; }
}

function safeSuffix(value = '') {
  const suffix = String(value || '').trim();
  if (!suffix) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(suffix) || suffix.startsWith('//') || suffix.includes('..')) {
    throw new Error('API path must be a relative path without traversal');
  }
  return '/' + suffix.replace(/^\/+/, '');
}

function policyValue(policy, token) {
  if (policy == null) return null;
  if (typeof policy === 'string' || typeof policy === 'number') return String(policy);
  return policy[token] == null ? null : String(policy[token]);
}

class OlanasAgent {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://olanas.xyz').replace(/\/$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
    this.signer = options.signer || null;
    if (!this.signer && options.privateKey) {
      if (!options.rpcUrl) throw new Error('rpcUrl is required when privateKey is supplied');
      this.signer = new ethers.Wallet(options.privateKey, new ethers.JsonRpcProvider(options.rpcUrl));
    }
    this.maxPricePerCall = options.maxPricePerCall ?? null;
    this.dailyBudget = options.dailyBudget ?? null;
    this.allowedServices = options.allowedServices ? new Set(options.allowedServices) : null;
    this.allowedTokens = new Set(options.allowedTokens || ['ETH', 'USDG', 'OLANAS']);
    this.autoApprove = options.autoApprove === true;
    this.approvePayment = options.approvePayment || null;
    this.spent = new Map();
  }

  async discover(query = '') {
    const url = new URL('/discovery/resources', this.baseUrl);
    if (query) url.searchParams.set('search', query);
    const response = await this.fetch(url);
    if (!response.ok) throw new Error(`Discovery failed with HTTP ${response.status}`);
    return response.json();
  }

  async service(slug) {
    const response = await this.fetch(`${this.baseUrl}/api/services/${encodeURIComponent(slug)}`);
    if (!response.ok) throw new Error(`Service lookup failed with HTTP ${response.status}`);
    return (await response.json()).service;
  }

  async call(slug, options = {}) {
    if (this.allowedServices && !this.allowedServices.has(slug)) throw new Error(`Service ${slug} is not allowed by agent policy`);
    const method = String(options.method || 'POST').toUpperCase();
    const url = `${this.baseUrl}/x402/${encodeURIComponent(slug)}${safeSuffix(options.path)}`;
    const headers = { ...(options.headers || {}) };
    const suppliedPayment = options.paymentProof || null;
    if (suppliedPayment) {
      if (!/^0x[0-9a-f]{64}$/i.test(suppliedPayment.txHash || '') || !ethers.isAddress(suppliedPayment.payer)) throw new Error('paymentProof must contain a valid transaction hash and payer');
      headers['payment-signature'] = base64Json({ scheme: 'onchain-tx', txHash: suppliedPayment.txHash, payer: suppliedPayment.payer });
    }
    let body = options.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    const request = () => this.fetch(url, { method, headers: { ...headers }, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
    const first = await request();
    if (first.status !== 402) return { response: first, receipt: decodeHeader(first.headers.get('payment-response')), payment: suppliedPayment };
    if (suppliedPayment) throw new Error(`Existing payment ${suppliedPayment.txHash} was not accepted; no second payment was sent`);

    const challenge = decodeHeader(first.headers.get('payment-required')) || await first.clone().json().catch(() => null);
    const requirement = this.normalizeRequirement(challenge);
    const approved = await this.authorize(slug, requirement);
    if (!approved) throw new Error('Payment was not approved by agent policy');
    const payment = await this.pay(requirement);
    this.recordSpend(requirement);
    headers['payment-signature'] = base64Json({ scheme: 'onchain-tx', txHash: payment.txHash, payer: payment.payer });
    const response = await request();
    if (response.status === 402) throw new Error(`Payment ${payment.txHash} was not accepted`);
    if (response.status >= 500) {
      const error = new Error(`Paid API returned HTTP ${response.status}; retry with the same payment proof before paying again`);
      error.payment = payment;
      error.response = response;
      error.retry = () => this.call(slug, { ...options, paymentProof: payment });
      throw error;
    }
    return { response, receipt: decodeHeader(response.headers.get('payment-response')), payment };
  }

  normalizeRequirement(challenge) {
    if (!challenge || Number(challenge.x402Version || 2) !== 2) throw new Error('The server returned an invalid x402 challenge');
    const accepted = challenge.accepts?.[0];
    const token = accepted?.extra?.name || challenge.token;
    const network = accepted?.network || (challenge.chainId ? `eip155:${challenge.chainId}` : null);
    const amount = accepted?.amount;
    const payTo = accepted?.payTo || challenge.recipient;
    if (!accepted || accepted.scheme !== 'onchain-tx' || !token || !amount || !payTo) throw new Error('No supported onchain-tx payment option was offered');
    return { token, network, amount: String(amount), payTo, asset: accepted.asset };
  }

  async networkConfig(requirement) {
    const response = await this.fetch(`${this.baseUrl}/api/services/networks`);
    if (!response.ok) throw new Error('Could not validate the payment network');
    const networks = (await response.json()).networks || [];
    const network = networks.find(item => item.caip2 === requirement.network);
    if (!network) throw new Error(`Unsupported payment network ${requirement.network}`);
    const token = network.tokens.find(item => item.symbol === requirement.token);
    if (!token) throw new Error(`Unsupported payment token ${requirement.token}`);
    const expectedAsset = token.address || ethers.ZeroAddress;
    if (ethers.getAddress(requirement.asset) !== ethers.getAddress(expectedAsset)) throw new Error('Payment asset does not match the verified network configuration');
    return { network, token };
  }

  async authorize(slug, requirement) {
    if (!this.signer) throw new Error('A signer or explicit privateKey + rpcUrl is required to pay');
    if (!this.allowedTokens.has(requirement.token)) throw new Error(`Token ${requirement.token} is not allowed by agent policy`);
    const { network, token } = await this.networkConfig(requirement);
    const maximum = policyValue(this.maxPricePerCall, requirement.token);
    const daily = policyValue(this.dailyBudget, requirement.token);
    if (maximum == null || daily == null) throw new Error('maxPricePerCall and dailyBudget must be configured before payments are enabled');
    const amount = BigInt(requirement.amount);
    if (amount > ethers.parseUnits(maximum, token.decimals)) throw new Error('Payment exceeds maxPricePerCall');
    const key = `${new Date().toISOString().slice(0, 10)}:${requirement.token}`;
    if ((this.spent.get(key) || 0n) + amount > ethers.parseUnits(daily, token.decimals)) throw new Error('Payment exceeds the dailyBudget');
    const approval = { slug, token: requirement.token, amount: ethers.formatUnits(amount, token.decimals), payTo: requirement.payTo, network };
    if (this.approvePayment) return Boolean(await this.approvePayment(approval));
    return this.autoApprove;
  }

  recordSpend(requirement) {
    const key = `${new Date().toISOString().slice(0, 10)}:${requirement.token}`;
    this.spent.set(key, (this.spent.get(key) || 0n) + BigInt(requirement.amount));
  }

  async pay(requirement) {
    const { network, token } = await this.networkConfig(requirement);
    if (!this.signer.provider) throw new Error('The payment signer must be connected to a provider');
    const signerNetwork = await this.signer.provider.getNetwork();
    if (Number(signerNetwork.chainId) !== Number(network.chainId)) throw new Error(`Signer must be connected to chain ${network.chainId}`);
    const amount = BigInt(requirement.amount);
    const transaction = token.address
      ? await new ethers.Contract(token.address, ERC20_ABI, this.signer).transfer(requirement.payTo, amount)
      : await this.signer.sendTransaction({ to: requirement.payTo, value: amount });
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error('Payment transaction did not confirm successfully');
    return { txHash: transaction.hash, payer: await this.signer.getAddress(), token: requirement.token, amount: requirement.amount };
  }
}

module.exports = { OlanasAgent, safeSuffix };
