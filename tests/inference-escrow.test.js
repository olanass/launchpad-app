'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.OLANAS_ESCROW_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.ORBIO_API_KEY = 'test-orbio-key';
process.env.VAULT_MASTER_SECRET = 'escrow-tests-only-32-character-master-secret';
process.env.CRON_SECRET = 'escrow-tests-only-cron-secret';
const { createEscrowRouter } = require('../src/server/inference/escrow');

test('escrow inference quotes a bounded USDG x402 payment without invoking Orbio', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/inference/escrow', createEscrowRouter());
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const listener = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const origin = 'http://127.0.0.1:' + listener.address().port;
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.orbio.so/') && String(url).endsWith('/models')) {
      calls++;
      return new Response(JSON.stringify({ data: [{ id: 'test/model', pricing: { prompt: '0.000001', completion: '0.000002' } }] }), { status: 200 });
    }
    return realFetch(url, options);
  };
  try {
    const response = await fetch(origin + '/api/inference/escrow/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test/model', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 })
    });
    assert.equal(response.status, 402);
    const requirement = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString());
    assert.equal(requirement.accepts[0].scheme, 'batch-settlement');
    assert.equal(requirement.accepts[0].network, 'eip155:4663');
    assert.equal(requirement.accepts[0].extra.assetTransferMethod, 'eip3009');
    assert.equal(requirement.accepts[0].extra.minDeposit, '2000000');
    assert.ok(calls > 0);
    const refundProbe = await fetch(origin + '/api/inference/escrow/refund');
    assert.equal(refundProbe.status, 402);
    const refundTerms = JSON.parse(Buffer.from(refundProbe.headers.get('payment-required'), 'base64').toString());
    assert.equal(refundTerms.accepts[0].payTo, requirement.accepts[0].payTo);
    assert.equal(refundTerms.accepts[0].extra.receiverAuthorizer, requirement.accepts[0].extra.receiverAuthorizer);
  } finally {
    global.fetch = realFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});
