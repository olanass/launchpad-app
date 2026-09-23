'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { ethers } = require('ethers');

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ORBIO_API_KEY = 'test-orbio-key';
process.env.VAULT_MASTER_SECRET = 'inference-tests-only-32-character-master-secret';
process.env.OLANAS_INFERENCE_PAYOUT_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const { router, db, keyMessage } = require('../src/server/inference/gateway');
const { serviceStore } = require('../src/server/services/store');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../src/server/config/chain');
const app = express();
app.use(express.json());
app.use('/api/inference', router);
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));

test('wallet key, token-metered call, and idempotent result', async () => {
  const listener = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const origin = 'http://127.0.0.1:' + listener.address().port;
  const realFetch = global.fetch;
  let completions = 0;
  let rpcProof;
  global.fetch = async (url, options) => {
    if (String(url) === chain.rpcUrl && rpcProof) {
      return new Response(JSON.stringify([
        { jsonrpc: '2.0', id: 1, result: '0x' + chain.chainId.toString(16) },
        { jsonrpc: '2.0', id: 2, result: rpcProof.receipt },
        { jsonrpc: '2.0', id: 3, result: rpcProof.transaction }
      ]), { status: 200 });
    }
    if (String(url).startsWith('https://api.orbio.so/')) {
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'test/model', pricing: { prompt: '0.000001', completion: '0.000002' } }] }), { status: 200 });
      completions++;
      return new Response(JSON.stringify({ id: 'chat-1', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'Hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    return realFetch(url, options);
  };
  try {
    const wallet = ethers.Wallet.createRandom();
    const challenge = await (await fetch(origin + '/api/inference/challenge')).json();
    assert.equal(challenge.messageTemplate, keyMessage('<address>', challenge.nonce));
    const signature = await wallet.signMessage(keyMessage(wallet.address, challenge.nonce));
    const keyResponse = await fetch(origin + '/api/inference/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: wallet.address, nonce: challenge.nonce, signature }) });
    assert.equal(keyResponse.status, 201);
    const key = (await keyResponse.json()).apiKey;
    const replay = await fetch(origin + '/api/inference/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: wallet.address, nonce: challenge.nonce, signature }) });
    assert.equal(replay.status, 409);
    const txHash = '0x' + 'ab'.repeat(32);
    const payoutAddress = ethers.getAddress(process.env.OLANAS_INFERENCE_PAYOUT_ADDRESS);
    const transfer = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
      .encodeEventLog('Transfer', [wallet.address, payoutAddress, 2500000n]);
    rpcProof = {
      receipt: { status: '0x1', transactionHash: txHash, blockNumber: '0x100', logs: [{ address: chain.supportedTokens.USDG.address, topics: transfer.topics, data: transfer.data }] },
      transaction: { hash: txHash, from: wallet.address, to: chain.supportedTokens.USDG.address, value: '0x0' }
    };
    const topupHeaders = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    const topupBody = JSON.stringify({ txHash, amountUsd: '2.50' });
    const topup = await fetch(origin + '/api/inference/topups', { method: 'POST', headers: topupHeaders, body: topupBody });
    assert.equal(topup.status, 200);
    assert.equal((await topup.json()).credited, true);
    const duplicate = await fetch(origin + '/api/inference/topups', { method: 'POST', headers: topupHeaders, body: topupBody });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).credited, false);
    const funded = await (await fetch(origin + '/api/inference/balance', { headers: topupHeaders })).json();
    assert.equal(funded.balanceMicros, 2500000);
    const client = await db();
    await client.execute({ sql: 'UPDATE inference_accounts SET balance_micros = 100000 WHERE wallet = ?', args: [wallet.address] });
    const body = JSON.stringify({ model: 'test/model', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 20 });
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'idempotency-key': 'inference-test-001' };
    const first = await fetch(origin + '/api/inference/v1/chat/completions', { method: 'POST', headers, body });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-olanas-charged-micros'), '20');
    const second = await fetch(origin + '/api/inference/v1/chat/completions', { method: 'POST', headers, body });
    assert.equal(second.status, 200);
    assert.equal(completions, 1);
    const stored = await client.execute({ sql: 'SELECT result FROM inference_calls WHERE request_id = ?', args: ['inference-test-001'] });
    assert.doesNotMatch(stored.rows[0].result, /Hi|chat-1/);
    const balance = await (await fetch(origin + '/api/inference/balance', { headers })).json();
    assert.equal(balance.balanceMicros, 99980);
  } finally {
    global.fetch = realFetch;
    await new Promise(resolve => listener.close(resolve));
    await serviceStore.close();
  }
});
