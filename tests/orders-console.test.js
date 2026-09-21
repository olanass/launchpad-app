'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
function fixture() {
  const nodes = new Map(), storage = new Map(), calls = [];
  let payments = 0;
  const order = { id: 'ord_' + 'a'.repeat(32), requestId: 'test-request', slug: 'pitch', method: 'POST', body: {},
    approvalStatus: 'pending', paymentStatus: 'unpaid', deliveryStatus: 'not_started',
    quote: { version: 1, name: 'Pitch', displayAmount: '0.002', token: 'USDG', recipient: '0xrecipient', expiresAt: Date.now() + 300000 } };
  const context = vm.createContext({ crypto: crypto.webcrypto, TextDecoder, Uint8Array, atob,
    handleBrowserPayment() {}, paymentConsoleState: { pending: null },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { location: {}, OlanasOrderWallet: { pay: async () => { payments++; } } },
    confirm: () => true, paymentSetStatus() {}, paymentSetStep() {}, paymentShowResult() {}, paymentButton() {}, paymentRecordHistory() {},
    serviceSigningProvider: async () => ({}), ensureRobinhoodNetwork: async () => true,
    fetch: async (url, options) => { calls.push(url); if (url.endsWith('/reject')) order.approvalStatus = 'rejected'; if (url.endsWith('/refresh')) { order.approvalStatus = 'pending'; order.quote.version++; } return new Response(JSON.stringify(order)); }
  });
  vm.runInContext(fs.readFileSync('src/client/scripts/orders.js', 'utf8'), context);
  context.initial = structuredClone(order);
  vm.runInContext("durableConsole.reference = {id: initial.id, token: 'a'.repeat(64)}; durableConsole.attached = true; durableConsole.order = initial;", context);
  return { context, order, calls, get payments() { return payments; } };
}
test('original payment console: Reject never falls through into wallet payment after an await', async () => {
  const f = fixture(); const event = { preventDefault() {}, currentTarget: { id: 'btnRetryPayment' } };
  const work = f.context.handleBrowserPayment(event); event.currentTarget = null; await work;
  assert.ok(f.calls.some(path => path.endsWith('/reject'))); assert.equal(f.payments, 0);
});
test('original payment console: expired quotes refresh without initiating payment', async () => {
  const f = fixture(); f.order.approvalStatus = 'expired';
  await f.context.handleBrowserPayment({ preventDefault() {} });
  assert.ok(f.calls.some(path => path.endsWith('/refresh'))); assert.equal(f.payments, 0);
});
test('original payment console: changed quote requires another review click', async () => {
  const f = fixture(); f.order.quote.version = 2;
  await f.context.handleBrowserPayment({ preventDefault() {} });
  assert.equal(f.payments, 0);
  await f.context.handleBrowserPayment({ preventDefault() {} });
  assert.equal(f.payments, 1);
});
