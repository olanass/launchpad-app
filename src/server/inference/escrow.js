'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ethers } = require('ethers');
const { createWalletClient, http, publicActions } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { x402Facilitator } = require('@x402/core/facilitator');
const { x402ResourceServer } = require('@x402/core/server');
const { toFacilitatorEvmSigner } = require('@x402/evm');
const { BatchSettlementEvmScheme: FacilitatorScheme } = require('@x402/evm/batch-settlement/facilitator');
const { BatchSettlementEvmScheme: ServerScheme } = require('@x402/evm/batch-settlement/server');
const { paymentMiddleware, setSettlementOverrides } = require('@x402/express');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const { serviceStore } = require('../services/store');
const { SqlChannelStorage } = require('./channel-storage');
const { costMicros } = require('./pricing');
const { sealResult, openResult } = require('./gateway');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const token = chain.supportedTokens.USDG;
const json = value => JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const baseUrl = () => (process.env.ORBIO_BASE_URL || 'https://api.orbio.so/api/v1').replace(/\/$/, '');

function input(body) {
  if (!body || body.stream === true || !/^[a-z0-9._/-]{1,150}$/i.test(body.model || '') ||
      !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 40 ||
      !body.messages.every(item => ['system', 'developer', 'user', 'assistant'].includes(item?.role) && typeof item.content === 'string') ||
      !Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 4096 ||
      Object.keys(body).some(key => !['model', 'messages', 'max_tokens', 'temperature', 'stream'].includes(key)) ||
      (body.temperature != null && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2))) {
    throw fail('A priced text model, text messages, and max_tokens from 1 to 4096 are required');
  }
  const serialized = json(body);
  if (Buffer.byteLength(serialized) > 16000) throw fail('Request exceeds 16 KB');
  return serialized;
}

async function orbio(path, options = {}) {
  if (!process.env.ORBIO_API_KEY) throw fail('Orbio gateway is not configured', 503);
  const response = await fetch(baseUrl() + path, {
    ...options,
    headers: { authorization: 'Bearer ' + process.env.ORBIO_API_KEY, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(options.method === 'POST' ? 40000 : 8000)
  });
  return { status: response.status, body: await response.json() };
}

let cachedModels, modelsExpiresAt = 0, modelsLoading;
async function modelList() {
  if (cachedModels && Date.now() < modelsExpiresAt) return cachedModels;
  if (!modelsLoading) modelsLoading = orbio('/models').then(response => {
    if (response.status !== 200 || !Array.isArray(response.body?.data)) throw fail('Orbio pricing unavailable', 503);
    cachedModels = response.body.data;
    modelsExpiresAt = Date.now() + 30000;
    return cachedModels;
  }).finally(() => { modelsLoading = null; });
  return modelsLoading;
}

async function quote(body) {
  const serialized = input(body);
  const models = await modelList();
  const model = models.find(item => item.id === body.model);
  if (!model?.pricing) throw fail('Model is unavailable or unpriced');
  const prompt = Number(model.pricing.prompt);
  const completion = Number(model.pricing.completion);
  if (![prompt, completion].every(value => Number.isFinite(value) && value >= 0)) throw fail('Invalid model pricing', 503);
  const maximum = Math.max(1, Math.ceil((Buffer.byteLength(serialized) * prompt + body.max_tokens * completion) * 1e6));
  if (!Number.isSafeInteger(maximum) || maximum > 2000000) throw fail('Maximum possible call cost exceeds $2', 400);
  return { serialized, pricing: model.pricing, maximum };
}

function createEscrowRouter() {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const privateKey = process.env.OLANAS_ESCROW_PRIVATE_KEY;
  if (!/^0x[0-9a-f]{64}$/i.test(privateKey || '') || !process.env.ORBIO_API_KEY ||
      !process.env.VAULT_MASTER_SECRET || process.env.VAULT_MASTER_SECRET.length < 32 ||
      !process.env.CRON_SECRET || (process.env.NODE_ENV === 'production' && !process.env.TURSO_DATABASE_URL)) {
    router.use((req, res) => res.status(503).json({ error: 'Escrow inference is not configured' }));
    return router;
  }
  const account = privateKeyToAccount(privateKey);
  const network = { id: chain.chainId, name: chain.name, nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [chain.rpcUrl] } } };
  const client = createWalletClient({ account, chain: network, transport: http(chain.rpcUrl) }).extend(publicActions);
  const signer = toFacilitatorEvmSigner(Object.assign({ address: account.address }, client), { confirmationTimeoutMs: 20000 });
  const facilitator = new x402Facilitator().register(chain.caip2, new FacilitatorScheme(signer));
  const scheme = new ServerScheme(account.address, {
    storage: new SqlChannelStorage(), receiverAuthorizerSigner: account, withdrawDelay: 900
  });
  const resource = new x402ResourceServer(facilitator).register(chain.caip2, scheme);
  router.get('/config', (req, res) => res.json({ network: chain.caip2, token: token.address,
    receiver: account.address, minDepositMicros: '2000000', maxCallMicros: '2000000' }));
  router.use(paymentMiddleware({
    'POST /chat/completions': {
      accepts: { scheme: 'batch-settlement', network: chain.caip2, payTo: account.address,
        price: async context => {
          const { maximum } = await quote(context.adapter.getBody());
          return { asset: token.address, amount: String(maximum), extra: {
            name: token.name, version: '1', assetTransferMethod: 'eip3009' } };
        },
        maxTimeoutSeconds: 120, extra: { minDeposit: '2000000' } },
      description: 'Metered AI inference, maximum authorized before execution, actual tokens charged afterward'
    },
    'GET /refund': {
      accepts: { scheme: 'batch-settlement', network: chain.caip2, payTo: account.address,
        price: { asset: token.address, amount: '1', extra: {
          name: token.name, version: '1', assetTransferMethod: 'eip3009' } },
        maxTimeoutSeconds: 120 },
      description: 'Return unused inference escrow to the original payer'
    }
  }, resource));
  router.get('/refund', (req, res) => res.status(405).json({ error: 'Only a signed x402 refund payload is accepted' }));
  router.post('/chat/completions', async (req, res, next) => {
    try {
      const { serialized, pricing, maximum } = await quote(req.body);
      const header = req.get('payment-signature');
      let payer;
      try { payer = ethers.getAddress(JSON.parse(Buffer.from(header, 'base64').toString()).payload.channelConfig.payer); }
      catch { throw fail('Verified escrow payer is missing', 400); }
      const requestId = req.get('idempotency-key');
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')) throw fail('Idempotency-Key is required');
      const clientDb = await serviceStore.init();
      await clientDb.execute('CREATE TABLE IF NOT EXISTS inference_escrow_calls (request_id TEXT PRIMARY KEY, payer TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, actual_micros INTEGER)');
      const requestHash = hash(serialized);
      const saved = await clientDb.execute({ sql: 'SELECT * FROM inference_escrow_calls WHERE request_id = ?', args: [requestId] });
      if (saved.rows[0]) {
        if (saved.rows[0].payer !== payer || saved.rows[0].request_hash !== requestHash) throw fail('Idempotency key belongs to another payer or request', 409);
        if (saved.rows[0].status !== 'completed') throw fail('Original call outcome is uncertain; do not retry under a new key', 409);
        setSettlementOverrides(res, { amount: '0' });
        return res.set('X-Olanas-Charged-Micros', String(saved.rows[0].actual_micros)).json(openResult(saved.rows[0].result));
      }
      const inserted = await clientDb.execute({ sql: 'INSERT OR IGNORE INTO inference_escrow_calls(request_id, payer, request_hash, status) VALUES (?, ?, ?, ?)', args: [requestId, payer, requestHash, 'pending'] });
      if (inserted.rowsAffected !== 1) throw fail('Request is already pending', 409);
      const response = await orbio('/chat/completions', { method: 'POST', body: serialized });
      if (response.status < 200 || response.status >= 300) {
        await clientDb.execute({ sql: 'UPDATE inference_escrow_calls SET status = ? WHERE request_id = ?', args: ['rejected', requestId] });
        return res.set('X-Olanas-No-Charge', 'true').status(502).json({ error: 'Orbio rejected the request; no inference charge was applied' });
      }
      const actual = costMicros(response.body.usage, pricing);
      if (actual > maximum) throw fail('Orbio usage exceeded the authorized maximum; no charge applied', 502);
      await clientDb.execute({ sql: 'UPDATE inference_escrow_calls SET status = ?, result = ?, actual_micros = ? WHERE request_id = ?', args: ['completed', sealResult(response.body), actual, requestId] });
      setSettlementOverrides(res, { amount: String(actual) });
      res.set('X-Olanas-Charged-Micros', String(actual)).json(response.body);
    } catch (error) { next(error); }
  });
  router.get('/channels/settle', async (req, res, next) => {
    try {
      if (!process.env.CRON_SECRET || req.get('authorization') !== 'Bearer ' + process.env.CRON_SECRET) throw fail('Unauthorized', 401);
      const outcome = await scheme.createChannelManager(facilitator, chain.caip2, token.address).claimAndSettle();
      res.json(outcome);
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createEscrowRouter, quote, input };
