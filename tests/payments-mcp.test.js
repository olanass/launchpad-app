'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { PaymentsWallet } = require('../payments-mcp/core');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const payer = '0x1111111111111111111111111111111111111111';
const payTo = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);
const chain = { chainId: 4663, supportedTokens: { USDG: { symbol: 'USDG', address: payTo, decimals: 6 } } };
const service = { slug: 'weather', name: 'Weather', status: 'live', price: '0.002', currency: 'USDG', payoutAddress: payTo, allowedMethods: ['POST'], chainId: 4663 };
const input = { slug: 'weather', requestId: 'request_001', body: { city: 'Bengaluru' } };
function setup(options = {}) {
  const calls = [];
  const wallet = new PaymentsWallet({ chain, baseUrl: 'https://example.com', verify: async () => ({ valid: true }),
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify(url.includes('/x402/') ? { ok: true } : { service }), { status: 200 }); }, ...options });
  wallet.connect(payer); return { wallet, calls };
}
test('payment intent pins Robinhood token, recipient and integer amount; no transfer on creation', async () => {
  const { wallet, calls } = setup(); const item = await wallet.request(input);
  assert.equal(item.amount, '2000'); assert.equal(item.payer, payer); assert.equal(item.payTo, payTo); assert.equal(item.status, 'pending');
  assert.equal(calls.length, 1); assert.equal(calls[0].opts.redirect, 'error');
});
test('repeated requestId returns existing intent; changed input rejected', async () => {
  const { wallet } = setup(); const a = await wallet.request(input); const b = await wallet.request(input); assert.equal(a.id, b.id);
  await assert.rejects(wallet.request({ ...input, body: {} }), /different input/);
});
test('concurrent request creation cannot duplicate an intent', async () => {
  const { wallet } = setup(); const results = await Promise.allSettled([wallet.request(input), wallet.request(input)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(wallet.state.intents.length, 1);
});
test('wrong network and unsupported tokens cannot be quoted', async () => {
  for (const changed of [{ chainId: 8453 }, { currency: 'FAKE' }]) {
    const { wallet } = setup({ fetchImpl: async () => new Response(JSON.stringify({ service: { ...service, ...changed } })) });
    await assert.rejects(wallet.request(input));
  }
});
test('unapproved, expired and rejected requests cannot pay', async () => {
  const { wallet } = setup(); const item = await wallet.request(input);
  await assert.rejects(wallet.complete(item.id, hash), /reviewed/);
  item.expiresAt = 0; assert.throws(() => wallet.begin(item.id), /expired/);
  wallet.reject(item.id); assert.throws(() => wallet.begin(item.id), /reviewed/);
});
test('transaction must verify before delivering paid API request', async () => {
  const { wallet, calls } = setup({ verify: async () => ({ valid: false, error: 'Wrong payer' }) });
  const item = await wallet.request(input); wallet.begin(item.id);
  await assert.rejects(wallet.complete(item.id, hash), /Wrong payer/); assert.equal(calls.length, 1);
  assert.equal(item.status, 'submitted');
});
test('verified payment sends original proof; completed calls are not repeated', async () => {
  const { wallet, calls } = setup(); const item = await wallet.request(input); wallet.begin(item.id);
  await wallet.complete(item.id, hash); await wallet.complete(item.id, hash);
  assert.equal(calls.length, 2); assert.equal(item.status, 'completed');
  assert.equal(JSON.parse(Buffer.from(calls[1].opts.headers['payment-signature'], 'base64')).txHash, hash);
});
test('delivery timeout keeps original hash and prevents replacement payments', async () => {
  const { wallet } = setup({ fetchImpl: async url => { if (url.includes('/x402/')) throw new Error('timeout'); return new Response(JSON.stringify({ service })); } });
  const item = await wallet.request(input); wallet.begin(item.id);
  await assert.rejects(wallet.complete(item.id, hash), /timeout/); assert.equal(item.status, 'delivery_unknown');
  await assert.rejects(wallet.complete(item.id, '0x' + 'cd'.repeat(32)), /original transaction/);
  assert.throws(() => wallet.begin(item.id), /reviewed/);
});
test('transaction cannot fund two local requests', async () => {
  const { wallet } = setup(); const a = await wallet.request(input); wallet.begin(a.id); await wallet.complete(a.id, hash);
  const b = await wallet.request({ ...input, requestId: 'request_002' }); wallet.begin(b.id);
  await assert.rejects(wallet.complete(b.id, hash), /another request/);
});
test('wallet and payment history survive restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olanas-mcp-test-')); const file = path.join(dir, 'state.json');
  try { const { wallet } = setup({ file }); const item = await wallet.request(input); wallet.begin(item.id);
    const second = setup({ file }).wallet; assert.equal(second.get(item.id).status, 'awaiting_wallet'); assert.equal(second.state.address, payer);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('URL and request input validation rejects redirect origins, traversal and oversize bodies', async () => {
  assert.throws(() => setup({ baseUrl: 'http://external.example' }), /HTTPS/);
  assert.throws(() => setup({ baseUrl: 'https://user:secret@example.com' }), /HTTPS/);
  const { wallet } = setup(); await assert.rejects(wallet.request({ ...input, slug: '../evil' }), /slug/);
  await assert.rejects(wallet.request({ ...input, body: 'x'.repeat(17000) }), /16 KB/);
});
test('stdio MCP + authenticated loopback companion work together without moving funds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olanas-mcp-integration-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('payments-mcp/server.js')], stderr: 'pipe',
    env: { ...process.env, PAYMENTS_MCP_PORT: '14782', PAYMENTS_DATA_DIR: dir, ROBINHOOD_NETWORK: 'mainnet', X402_DEMO_MODE: 'false' } });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(transport); const list = await client.listTools(); assert.equal(list.tools.length, 7);
    assert.ok(!list.tools.some(tool => /send|withdraw|approve/.test(tool.name)));
    const result = await client.callTool({ name: 'show_wallet', arguments: {} }); const { walletUrl } = JSON.parse(result.content[0].text);
    const url = new URL(walletUrl); const auth = url.hash.slice(1);
    const html = await fetch(url.origin); assert.equal(html.status, 200); assert.match(await html.text(), /Send funds out/);
    assert.equal((await fetch(url.origin + '/api/state')).status, 401);
    assert.equal((await fetch(url.origin + '/api/state', { headers: { authorization: 'Bearer ' + auth, origin: 'https://evil.example' } })).status, 403);
    const state = await fetch(url.origin + '/api/state', { headers: { authorization: 'Bearer ' + auth } }); assert.equal((await state.json()).chain.chainId, 4663);
    const noWallet = await client.callTool({ name: 'request_paid_api', arguments: input }); assert.equal(noWallet.isError, true);
  } finally { await client.close(); fs.rmSync(dir, { recursive: true }); }
});
