'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ethers } = require('ethers');
const { serviceStore } = require('../services/store');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const { verifyPayment } = require('../facilitator/verifier');
const { costMicros } = require('./pricing');

const router = express.Router();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function resultKey() {
  const secret = process.env.VAULT_MASTER_SECRET;
  if (!secret || secret.length < 32) throw fail('Inference result encryption is not configured', 503);
  return crypto.createHash('sha256').update(secret).digest();
}
function sealResult(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', resultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: ciphertext.toString('base64') });
}
function openResult(saved) {
  const record = JSON.parse(saved);
  const decipher = crypto.createDecipheriv('aes-256-gcm', resultKey(), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.body, 'base64')), decipher.final()]).toString());
}
const keyMessage = (address, nonce) => 'Olanas inference API key\nChain: ' + chain.chainId + '\nWallet: ' + address + '\nNonce: ' + nonce;
const baseUrl = () => (process.env.ORBIO_BASE_URL || 'https://api.orbio.so/api/v1').replace(/\/$/, '');
const payout = () => {
  if (!process.env.ORBIO_API_KEY || !process.env.OLANAS_INFERENCE_PAYOUT_ADDRESS) throw fail('Inference is not configured', 503);
  resultKey();
  return ethers.getAddress(process.env.OLANAS_INFERENCE_PAYOUT_ADDRESS);
};

async function db() {
  const client = await serviceStore.init();
  await client.execute('CREATE TABLE IF NOT EXISTS inference_accounts (wallet TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, balance_micros INTEGER NOT NULL DEFAULT 0)');
  await client.execute('CREATE TABLE IF NOT EXISTS inference_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  await client.execute('CREATE TABLE IF NOT EXISTS inference_topups (tx_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, amount_micros INTEGER NOT NULL)');
  await client.execute('CREATE TABLE IF NOT EXISTS inference_calls (request_id TEXT PRIMARY KEY, wallet TEXT NOT NULL, request_hash TEXT NOT NULL, reserved_micros INTEGER NOT NULL, status TEXT NOT NULL, result TEXT)');
  return client;
}
async function account(req) {
  const key = (req.get('authorization') || '').replace(/^Bearer /i, '');
  if (!/^oln_[a-f0-9]{64}$/.test(key)) throw fail('Inference API key required', 401);
  const client = await db();
  const rows = await client.execute({ sql: 'SELECT wallet, balance_micros FROM inference_accounts WHERE key_hash = ?', args: [sha(key)] });
  if (!rows.rows[0]) throw fail('Invalid inference API key', 401);
  return { client, wallet: rows.rows[0].wallet, balanceMicros: Number(rows.rows[0].balance_micros) };
}
async function orbio(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.method === 'POST' ? 40000 : 8000);
  try {
    const response = await fetch(baseUrl() + path, {
      ...options, signal: controller.signal,
      headers: { authorization: 'Bearer ' + process.env.ORBIO_API_KEY, 'content-type': 'application/json' }
    });
    const body = await response.json();
    return { status: response.status, body };
  } finally { clearTimeout(timer); }
}
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/challenge', async (req, res) => {
  payout();
  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60000;
  const client = await db();
  await client.execute({ sql: 'INSERT INTO inference_nonces(nonce, expires_at) VALUES (?, ?)', args: [nonce, expiresAt] });
  res.json({ nonce, expiresAt, messageTemplate: keyMessage('<address>', nonce) });
});
router.post('/keys', async (req, res) => {
  payout();
  const { address, nonce, signature } = req.body || {};
  if (!/^[a-f0-9]{48}$/.test(nonce || '')) throw fail('Invalid or expired challenge');
  let wallet;
  try { wallet = ethers.getAddress(address); } catch { throw fail('Invalid wallet address'); }
  try { if (ethers.verifyMessage(keyMessage(wallet, nonce), signature) !== wallet) throw Error(); }
  catch { throw fail('Wallet signature did not match', 401); }
  const client = await db();
  const used = await client.execute({ sql: 'DELETE FROM inference_nonces WHERE nonce = ? AND expires_at > ?', args: [nonce, Date.now()] });
  if (used.rowsAffected !== 1) throw fail('Challenge has expired or was already used', 409);
  const key = 'oln_' + crypto.randomBytes(32).toString('hex');
  await client.execute({ sql: 'INSERT INTO inference_accounts(wallet, key_hash, balance_micros) VALUES (?, ?, 0) ON CONFLICT(wallet) DO UPDATE SET key_hash = excluded.key_hash', args: [wallet, sha(key)] });
  res.status(201).json({ apiKey: key, wallet, baseURL: req.protocol + '://' + req.get('host') + '/api/inference/v1', note: 'Save this key now. Creating another key revokes the previous one.' });
});
router.get('/balance', async (req, res) => {
  const a = await account(req);
  res.json({ wallet: a.wallet, balanceUsd: (a.balanceMicros / 1e6).toFixed(6), balanceMicros: a.balanceMicros, chainId: chain.chainId, token: 'USDG', recipient: payout(), minimumTopupUsd: '0.01' });
});
router.post('/topups', async (req, res) => {
  const a = await account(req);
  const { txHash, amountUsd } = req.body || {};
  if (!/^0x[0-9a-f]{64}$/i.test(txHash || '') || !/^(?:[0-9]+)(?:\.[0-9]{1,6})?$/.test(amountUsd || '')) throw fail('Valid transaction hash and USDG amount are required');
  const amount = ethers.parseUnits(amountUsd, 6);
  if (amount < 10000n || amount > 1000000000n) throw fail('Top-up must be between $0.01 and $1000');
  const requirement = { token: 'USDG', price: amountUsd, recipient: payout(), resource: '/api/inference/topups' };
  const checked = await verifyPayment({ scheme: 'onchain-tx', payer: a.wallet, txHash }, requirement);
  if (!checked.valid || checked.isSimulated) throw fail(checked.error || 'Payment not confirmed', 409);
  const receipt = await serviceStore.settlePayment(checked, { endpoint: requirement.resource });
  const tx = await a.client.transaction('write');
  try {
    const insert = await tx.execute({ sql: 'INSERT OR IGNORE INTO inference_topups(tx_hash, wallet, amount_micros) VALUES (?, ?, ?)', args: [txHash.toLowerCase(), a.wallet, Number(amount)] });
    if (insert.rowsAffected === 1) await tx.execute({ sql: 'UPDATE inference_accounts SET balance_micros = balance_micros + ? WHERE wallet = ?', args: [Number(amount), a.wallet] });
    const balance = await tx.execute({ sql: 'SELECT balance_micros FROM inference_accounts WHERE wallet = ?', args: [a.wallet] });
    await tx.commit();
    res.json({ receipt, credited: insert.rowsAffected === 1, balanceMicros: Number(balance.rows[0].balance_micros) });
  } catch (error) { await tx.rollback(); throw error; }
});
router.get('/v1/models', async (req, res) => {
  await account(req);
  payout();
  const response = await orbio('/models');
  res.status(response.status).json(response.body);
});
router.post('/v1/chat/completions', async (req, res) => {
  const a = await account(req);
  payout();
  const body = req.body || {};
  if (body.stream === true) throw fail('Streaming is not supported yet; use stream: false', 400);
  const supported = new Set(['model', 'messages', 'max_tokens', 'max_completion_tokens', 'temperature', 'stream']);
  if (Object.keys(body).some(key => !supported.has(key))) throw fail('Unsupported chat parameter; only text completions are available');
  if (body.max_tokens != null && body.max_completion_tokens != null) throw fail('Choose one output token limit');
  if (body.temperature != null && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) throw fail('Invalid temperature');
  if (!/^[a-z0-9._/-]{1,150}$/i.test(body.model || '') || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 40) throw fail('A model and 1–40 text messages are required');
  if (!body.messages.every(item => ['system', 'developer', 'user', 'assistant'].includes(item?.role) && typeof item.content === 'string')) throw fail('Only text messages are supported');
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) throw fail('max_tokens from 1 to 4096 is required');
  const serialized = JSON.stringify(body);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > 16000) throw fail('Request exceeds 16 KB');
  const models = await orbio('/models');
  if (models.status !== 200 || !Array.isArray(models.body?.data)) throw fail('Orbio model pricing is unavailable', 503);
  const model = models.body.data.find(item => item.id === body.model);
  if (!model?.pricing) throw fail('Model not available with published pricing', 400);
  const promptPrice = Number(model.pricing.prompt);
  const completionPrice = Number(model.pricing.completion);
  if (![promptPrice, completionPrice].every(value => Number.isFinite(value) && value >= 0)) throw fail('Model pricing is invalid', 503);
  // UTF-8 byte length is a conservative bound for text token count.
  const reserved = Math.max(1, Math.ceil((bytes * promptPrice + maxTokens * completionPrice) * 1e6));
  if (reserved > 5000000) throw fail('Maximum possible charge exceeds $5; shorten the request', 400);
  const requestId = req.get('idempotency-key') || crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw fail('Invalid idempotency key');
  const requestHash = sha(serialized);
  const tx = await a.client.transaction('write');
  try {
    const old = await tx.execute({ sql: 'SELECT wallet, request_hash, status, result FROM inference_calls WHERE request_id = ?', args: [requestId] });
    if (old.rows[0]) {
      await tx.commit();
      if (old.rows[0].wallet !== a.wallet || old.rows[0].request_hash !== requestHash) throw fail('Idempotency key belongs to another request', 409);
      if (old.rows[0].status !== 'completed') throw fail('Original call is pending; do not retry with a new key', 409);
      return res.json(openResult(old.rows[0].result));
    }
    const debit = await tx.execute({ sql: 'UPDATE inference_accounts SET balance_micros = balance_micros - ? WHERE wallet = ? AND balance_micros >= ?', args: [reserved, a.wallet, reserved] });
    if (debit.rowsAffected !== 1) throw fail('Insufficient balance for maximum call cost; top up a small amount', 402);
    await tx.execute({ sql: 'INSERT INTO inference_calls(request_id, wallet, request_hash, reserved_micros, status) VALUES (?, ?, ?, ?, ?)', args: [requestId, a.wallet, requestHash, reserved, 'pending'] });
    await tx.commit();
  } catch (error) { try { await tx.rollback(); } catch {} throw error; }
  let response;
  try { response = await orbio('/chat/completions', { method: 'POST', body: serialized }); }
  catch { throw fail('Upstream outcome unknown. Reserved balance is held; contact support with idempotency key ' + requestId, 502); }
  if (response.status < 200 || response.status >= 300) {
    const tx2 = await a.client.transaction('write');
    try {
      await tx2.execute({ sql: 'UPDATE inference_accounts SET balance_micros = balance_micros + ? WHERE wallet = ?', args: [reserved, a.wallet] });
      await tx2.execute({ sql: 'UPDATE inference_calls SET status = ?, result = ? WHERE request_id = ? AND status = ?', args: ['rejected', sealResult(response.body), requestId, 'pending'] });
      await tx2.commit();
    } catch (error) { await tx2.rollback(); throw error; }
    return res.status(response.status).json(response.body);
  }
  let charged;
  try { charged = costMicros(response.body.usage, model.pricing); }
  catch { throw fail('Upstream usage missing. Reserved balance is held for reconciliation; contact support with idempotency key ' + requestId, 502); }
  const billed = Math.min(charged, reserved);
  const tx3 = await a.client.transaction('write');
  try {
    await tx3.execute({ sql: 'UPDATE inference_accounts SET balance_micros = balance_micros + ? WHERE wallet = ?', args: [reserved - billed, a.wallet] });
    await tx3.execute({ sql: 'UPDATE inference_calls SET status = ?, result = ? WHERE request_id = ? AND status = ?', args: ['completed', sealResult(response.body), requestId, 'pending'] });
    await tx3.commit();
  } catch (error) { await tx3.rollback(); throw error; }
  res.set('X-Olanas-Charged-Micros', String(billed)).json(response.body);
});

module.exports = { router, db, keyMessage, sealResult, openResult };
