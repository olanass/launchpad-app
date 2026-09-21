'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { ethers } = require('ethers');
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.VAULT_MASTER_SECRET = 'order-tests-only-secret-not-used-in-production';
const { OrderEngine, approvalMessage } = require('../src/server/orders/engine');
const payer = ethers.Wallet.createRandom();
const recipient = ethers.Wallet.createRandom().address;
const secret = () => crypto.randomBytes(32).toString('hex');
const tx = () => '0x' + secret();
async function fixture() {
  const db = createClient({ url: 'file::memory:' });
  const service = { slug: 'pitch', serviceId: 'svc_pitch', name: 'Pitch scorer', price: '0.002', currency: 'USDG',
    chainId: 4663, status: 'live', allowedMethods: ['POST'], payoutAddress: recipient, endpointUrl: 'https://service.example/score' };
  let calls = 0;
  const redemptions = new Map();
  const services = { init: async () => db, getBySlug: async slug => slug === 'pitch' ? service : null,
    settlePayment: async (checked, metadata) => {
      const old = redemptions.get(checked.txHash);
      if (old && old.metadata.endpoint !== metadata.endpoint) throw new Error('Payment already used');
      const receipt = old || { receiptId: 'rcpt_' + checked.txHash, txHash: checked.txHash, metadata };
      redemptions.set(checked.txHash, receipt); return receipt;
    } };
  const deps = { services, verify: async proof => ({ valid: true, ...proof, amount: '0.002' }),
    proxy: async () => { calls++; return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"score":88}') }; } };
  const engine = new OrderEngine(deps);
  const token = secret(); const input = { slug: 'pitch', method: 'POST', body: { name: 'Olanas', pitch: 'Example' }, requestId: 'test-purchase-001', accessToken: token };
  const order = await engine.create(input);
  const approve = async (target = order, key = token) => {
    const challenge = await engine.approval(target.id, key, payer.address);
    return engine.approve(target.id, key, { payer: payer.address, signature: await payer.signMessage(challenge.message), quoteVersion: challenge.quoteVersion });
  };
  return { db, engine, order, token, input, service, deps, approve, calls: () => calls };
}

test('orders: concurrent duplicate creation returns one order; changed input conflicts', async () => {
  const f = await fixture();
  try {
    const all = await Promise.all(Array.from({ length: 8 }, () => f.engine.create(f.input)));
    assert.ok(all.every(o => o.id === f.order.id));
    await assert.rejects(f.engine.create({ ...f.input, body: {} }), /different input/);
    await assert.rejects(f.engine.get(f.order.id, secret()), /access denied/);
    assert.equal(f.calls(), 0);
  } finally { f.db.close(); }
});
test('orders: reject, reopen and expiry cannot silently approve or change identities', async () => {
  const f = await fixture();
  try {
    await f.engine.review(f.order.id, f.token, 'reject');
    assert.equal((await f.engine.create(f.input)).approvalStatus, 'rejected');
    await assert.rejects(f.approve(), /not awaiting/);
    const reopened = await f.engine.review(f.order.id, f.token, 'reopen');
    assert.equal(reopened.id, f.order.id); assert.equal(reopened.quote.version, 2);
    const raw = await f.engine.load(f.order.id, f.token); raw.quote.expiresAt = 0; await f.engine.save(raw);
    assert.equal((await f.engine.get(f.order.id, f.token)).approvalStatus, 'expired');
    await assert.rejects(f.approve(), /expired/);
    f.service.price = '0.005';
    const refreshed = await f.engine.review(f.order.id, f.token, 'refresh');
    assert.equal(refreshed.quote.displayAmount, '0.005'); assert.equal(refreshed.approvalStatus, 'pending');
    assert.equal(f.calls(), 0);
  } finally { f.db.close(); }
});
test('orders: stale or forged approval cannot authorize payment; simultaneous approvals have one winner', async () => {
  const f = await fixture();
  try {
    const challenge = await f.engine.approval(f.order.id, f.token, payer.address);
    const signature = await payer.signMessage(challenge.message);
    await f.engine.review(f.order.id, f.token, 'refresh');
    await assert.rejects(f.engine.approve(f.order.id, f.token, { payer: payer.address, signature, quoteVersion: 1 }), /changed/);
    await assert.rejects(f.engine.approve(f.order.id, f.token, { payer: recipient, signature, quoteVersion: 2 }), /signature/);
    const results = await Promise.allSettled([f.approve(), f.approve()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await assert.rejects(f.engine.review(f.order.id, f.token, 'refresh'), /already started/);
  } finally { f.db.close(); }
});
test('orders: paid result survives process restart and retries without another execution', async () => {
  const f = await fixture();
  try {
    await f.approve(); const hash = tx();
    await f.engine.submit(f.order.id, f.token, hash);
    f.service.price = '9'; f.service.endpointUrl = 'https://changed.example';
    const result = await f.engine.reconcile(f.order.id, f.token);
    assert.equal(result.deliveryStatus, 'completed');
    assert.equal(Buffer.from(result.result.body, 'base64').toString(), '{"score":88}');
    assert.equal(result.quote.displayAmount, '0.002');
    const restarted = new OrderEngine(f.deps);
    assert.deepEqual((await restarted.get(f.order.id, f.token)).result, result.result);
    await restarted.reconcile(f.order.id, f.token);
    assert.equal(f.calls(), 1);
    await assert.rejects(restarted.submit(f.order.id, f.token, tx()), /original transaction/);
  } finally { f.db.close(); }
});
test('orders: simultaneous reconciliation executes once', async () => {
  const f = await fixture();
  try {
    await f.approve(); await f.engine.submit(f.order.id, f.token, tx());
    await Promise.allSettled([f.engine.reconcile(f.order.id, f.token), f.engine.reconcile(f.order.id, f.token)]);
    assert.equal(f.calls(), 1);
    assert.equal((await f.engine.get(f.order.id, f.token)).deliveryStatus, 'completed');
  } finally { f.db.close(); }
});
test('orders: lost upstream response is unknown and never automatically replayed', async () => {
  const f = await fixture();
  try {
    let calls = 0; f.engine.proxy = async () => { calls++; throw Error('socket lost after remote execution'); };
    await f.approve(); await f.engine.submit(f.order.id, f.token, tx());
    assert.equal((await f.engine.reconcile(f.order.id, f.token)).deliveryStatus, 'unknown');
    await f.engine.reconcile(f.order.id, f.token); assert.equal(calls, 1);
    assert.equal((await f.engine.get(f.order.id, f.token)).paymentStatus, 'confirmed');
  } finally { f.db.close(); }
});
test('orders: pending or invalid transaction never reaches service; payment proof cannot buy another order', async () => {
  const f = await fixture();
  try {
    await f.approve(); const hash = tx(); await f.engine.submit(f.order.id, f.token, hash);
    f.engine.verify = async () => ({ valid: false, error: 'Transaction pending or not found' });
    assert.equal((await f.engine.reconcile(f.order.id, f.token)).paymentStatus, 'submitted');
    assert.equal(f.calls(), 0);
    f.engine.verify = f.deps.verify; await f.engine.reconcile(f.order.id, f.token);
    const second = await f.engine.create({ ...f.input, requestId: 'different-order' });
    await f.approve(second); await f.engine.submit(second.id, f.token, hash);
    await assert.rejects(f.engine.reconcile(second.id, f.token), /already used/);
    assert.equal(f.calls(), 1);
  } finally { f.db.close(); }
});
test('orders: crashes after claiming execution remain ambiguous and do not replay', async () => {
  const f = await fixture();
  try {
    await f.approve(); await f.engine.submit(f.order.id, f.token, tx());
    const raw = await f.engine.load(f.order.id, f.token);
    raw.paymentStatus = 'confirmed'; raw.deliveryStatus = 'executing'; raw.executionStartedAt = Date.now() - 61000;
    await f.engine.save(raw);
    assert.equal((await f.engine.get(f.order.id, f.token)).deliveryStatus, 'unknown');
    await f.engine.reconcile(f.order.id, f.token); assert.equal(f.calls(), 0);
  } finally { f.db.close(); }
});

test('orders: cancellation requires the approving wallet and cannot erase a submitted payment', async () => {
  const f = await fixture();
  try {
    await f.approve();
    const challenge = await f.engine.cancellation(f.order.id, f.token);
    await assert.rejects(f.engine.cancelApproval(f.order.id, f.token, { signature: await ethers.Wallet.createRandom().signMessage(challenge.message), revision: challenge.revision }), /approving wallet/);
    const reopened = await f.engine.cancelApproval(f.order.id, f.token, { signature: await payer.signMessage(challenge.message), revision: challenge.revision });
    assert.equal(reopened.approvalStatus, 'pending'); assert.equal(reopened.quote.version, 2);
    await f.approve(); await f.engine.submit(f.order.id, f.token, tx());
    await assert.rejects(f.engine.cancellation(f.order.id, f.token), /Only an unpaid/);
    await assert.rejects(f.engine.cancelApproval(f.order.id, f.token, { signature: await payer.signMessage(challenge.message), revision: challenge.revision }), /already submitted/);
  } finally { f.db.close(); }
});
test('orders: exact method, path and body are bound; unsafe paths are rejected', async () => {
  const f = await fixture();
  try {
    for (const path of ['https://evil.test', '//evil.test', '/%2e%2e/admin', '/%252e%252e/admin', '/a\\b', '/a#fragment']) {
      await assert.rejects(f.engine.create({ ...f.input, requestId: secret(), path }));
    }
    const routed = await f.engine.create({ ...f.input, requestId: 'routed-order', path: '/v1?city=Delhi' });
    await f.approve(routed); await f.engine.submit(routed.id, f.token, tx());
    let target;
    f.engine.proxy = async (url, options) => { target = url.toString(); assert.equal(options.headers['idempotency-key'], routed.id); return { status: 422, headers: {}, body: Buffer.from('invalid input') }; };
    const result = await f.engine.reconcile(routed.id, f.token);
    assert.equal(target, 'https://service.example/score/v1?city=Delhi');
    assert.equal(result.result.status, 422); assert.equal(result.deliveryStatus, 'completed');
    assert.notEqual(routed.requestHash, f.order.requestHash);
  } finally { f.db.close(); }
});
test('orders: schema validation rejects invalid input before creating a payable order', async () => {
  const f = await fixture();
  try {
    f.service.openapiDocument = { openapi: '3.0.3', paths: { '/': { post: { requestBody: { required: true, content: {
      'application/json': { schema: { type: 'object', required: ['pitch'], properties: { pitch: { type: 'string', minLength: 5 } }, additionalProperties: false } }
    } } } } } };
    await assert.rejects(f.engine.create({ ...f.input, requestId: 'invalid-schema-order', body: { pitch: 'x' } }), /Invalid service input/);
    const good = await f.engine.create({ ...f.input, requestId: 'valid-schema-order', body: { pitch: 'An interesting business' } });
    assert.equal(good.approvalStatus, 'pending');
    assert.equal(f.calls(), 0);
    const count = await f.db.execute('SELECT COUNT(*) AS count FROM purchase_orders'); assert.equal(Number(count.rows[0].count), 2);
  } finally { f.db.close(); }
});

test('orders: HTTP and MCP share private durable orders, verified payment, saved result and idempotent analytics', async () => {
  const { serviceStore } = require('../src/server/services/store');
  const { orders } = require('../src/server/orders/engine');
  const app = require('../src/server/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const originalVerify = orders.verify, originalProxy = orders.proxy;
  let calls = 0;
  try {
    const service = await serviceStore.create({ name: 'HTTP test', description: 'Fixture', category: 'Tests', price: '0.002', currency: 'USDG',
      endpointUrl: 'https://example.test', allowedMethods: ['POST'], creatorAddress: recipient, payoutAddress: recipient, creatorSignature: secret() });
    const token = secret();
    const request = async (path, body, auth = token) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, data: await response.json() };
    };
    const mcp = async (name, args) => {
      const response = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const result = await response.json(); assert.ok(!result.error, JSON.stringify(result));
      return result.result.structuredContent || JSON.parse(result.result.content[0].text);
    };
    const created = await mcp('create_order', { slug: service.slug, requestId: 'http-test-order', accessToken: token, method: 'POST', body: { pitch: 'Hello' } });
    const identity = await mcp('new_order_identity', {});
    assert.match(identity.accessToken, /^[a-f0-9]{64}$/); assert.ok(identity.requestId.length >= 8);
    const id = created.order.id;
    assert.ok(created.approvalUrl.endsWith('/orders/' + id + '#' + token));
    const path = '/api/orders/' + id;
    assert.equal((await request(path, undefined, secret())).status, 404);
    const read = await request(path);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(read.data.endpointUrl, undefined); assert.equal(read.data.accessHash, undefined);
    const challenge = (await request(path + '/approval-message', { payer: payer.address })).data;
    assert.equal((await request(path + '/approve', { payer: payer.address, signature: await payer.signMessage(challenge.message), quoteVersion: challenge.quoteVersion })).status, 200);
    const hash = tx();
    assert.equal((await request(path + '/payment', { txHash: hash })).status, 200);
    orders.verify = async proof => ({ valid: true, ...proof, token: 'USDG', amount: '0.002', recipient, redemptionKey: 'tx:4663:' + proof.txHash });
    orders.proxy = async () => { calls++; return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"score":92}') }; };
    const completed = await mcp('reconcile_order', { orderId: id, accessToken: token });
    assert.equal(completed.order.deliveryStatus, 'completed');
    assert.equal(Buffer.from(completed.order.result.body, 'base64').toString(), '{"score":92}');
    await mcp('reconcile_order', { orderId: id, accessToken: token });
    assert.equal((await mcp('get_order', { orderId: id, accessToken: token })).order.paymentStatus, 'confirmed');
    assert.equal(calls, 1);
    const updated = await serviceStore.getBySlug(service.slug);
    assert.equal(updated.paidRequests, 1); assert.equal(updated.totalEarned, '0.002');
  } finally {
    orders.verify = originalVerify; orders.proxy = originalProxy;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await serviceStore.close();
  }
});
