'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const { PaymentsWallet } = require('../payments-mcp/core');
const { AutonomousPayments, ownerGuard } = require('../payments-mcp/autonomous');
const { OlanasRobinhoodSigner, loadSigningWallet } = require('../payments-mcp/olanas');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const privateTestWallet = new ethers.Wallet('0x' + '12'.repeat(32));
const address = privateTestWallet.address;
const payTo = '0x2222222222222222222222222222222222222222';
const tokenAddress = '0x3333333333333333333333333333333333333333';
const hash = '0x' + 'ab'.repeat(32);
const chain = { chainId: 4663, supportedTokens: { ETH: { symbol: 'ETH', decimals: 18, address: null }, USDG: { symbol: 'USDG', decimals: 6, address: tokenAddress } } };
const input = { slug: 'weather', requestId: 'request_001', method: 'POST', body: { city: 'Bengaluru' } };
const policy = { token: 'USDG', perCall: '0.002', budget: '0.003', gasPerCall: '0.00001', gasBudget: '0.00002', minutes: 60 };
function fixture(overrides = {}) {
  let broadcasts = 0, signatures = 0;
  const wallet = new PaymentsWallet({ chain, baseUrl: 'https://example.com', verify: async () => ({ valid: true }),
    fetchImpl: async url => new Response(JSON.stringify(url.includes('/x402/') ? { ok: true } : { service: {
      name: 'Weather', status: 'live', price: '0.002', currency: 'USDG', payoutAddress: payTo, allowedMethods: ['POST'], chainId: 4663
    } })) });
  wallet.connect(address);
  const signer = { address, prepare: async () => ({ transaction: {}, gasCost: 100n }),
    sign: async () => { signatures++; return { raw: 'signed-test-only', hash }; },
    broadcast: async () => { broadcasts++; }, receipt: async () => ({ status: 1 }), ...overrides };
  const auto = new AutonomousPayments(wallet, signer);
  return { wallet, auto, signer, counts: () => ({ broadcasts, signatures }) };
}
test('no local keystore or owner password means fail closed', async () => {
  await assert.rejects(loadSigningWallet({}), /OLANAS_KEYSTORE_FILE/);
  assert.throws(() => ownerGuard('short'), /16 characters/);
  assert.throws(() => new OlanasRobinhoodSigner({ chain: { chainId: 8453 }, wallet: privateTestWallet }), /Robinhood/);
});
test('autonomy is disabled until the owner enables a budget', async () => {
  const f = fixture(); await assert.rejects(f.auto.execute(input), /Enable/); assert.equal(f.counts().signatures, 0);
});
test('approved request pays autonomously and returns response; repeat ID never pays twice', async () => {
  const f = fixture(); f.auto.enable(policy);
  const first = await f.auto.execute(input); const second = await f.auto.execute(input);
  assert.equal(first.status, 'completed'); assert.equal(first.id, second.id); assert.deepEqual(f.counts(), { signatures: 1, broadcasts: 1 });
  assert.equal(f.wallet.state.policy.spent, '2000'); assert.equal(f.wallet.state.policy.gasSpent, '100');
});
test('concurrent calls cannot exceed the session budget', async () => {
  const f = fixture(); f.auto.enable(policy);
  const results = await Promise.allSettled([f.auto.execute(input), f.auto.execute({ ...input, requestId: 'request_002' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(f.counts().signatures, 1);
});
test('per-call cap, token and session expiry are enforced', async () => {
  for (const change of [{ perCall: '0.001' }, { token: 'ETH' }]) {
    const f = fixture(); f.auto.enable({ ...policy, ...change }); await assert.rejects(f.auto.execute(input)); assert.equal(f.counts().signatures, 0);
  }
  const f = fixture(); f.auto.enable(policy); f.wallet.state.policy.expiresAt = 0; await assert.rejects(f.auto.execute(input), /unexpired/);
});
test('a bounded session permits any service slug on the configured launchpad', async () => {
  const f = fixture(); f.auto.enable(policy);
  const item = await f.auto.execute({ ...input, slug: 'image-generator', requestId: 'request_other_service' });
  assert.equal(item.slug, 'image-generator'); assert.equal(item.status, 'completed'); assert.equal(f.counts().signatures, 1);
});
test('gas budget and revocation stop signing', async () => {
  const f = fixture({ prepare: async () => ({ transaction: {}, gasCost: 100000000000000n }) }); f.auto.enable(policy);
  await assert.rejects(f.auto.execute(input), /gas budget/); assert.equal(f.counts().signatures, 0);
  f.auto.revoke(); await assert.rejects(f.auto.execute(input), /Enable/);
});
test('revocation while signing prevents broadcast', async () => {
  const f = fixture(); f.signer.sign = async () => { f.auto.revoke(); return { raw: 'signed', hash }; }; f.auto.enable(policy);
  await assert.rejects(f.auto.execute(input), /revoked/); assert.equal(f.counts().broadcasts, 0); assert.equal(f.wallet.state.policy.spent, '2000');
});
test('broadcast timeout preserves hash and reservation; no new signature on retries', async () => {
  const f = fixture({ broadcast: async () => { throw new Error('timeout'); }, receipt: async () => null }); f.auto.enable(policy);
  const item = await f.auto.execute(input); assert.equal(item.status, 'submitted'); assert.equal(item.txHash, hash);
  await f.auto.execute(input); assert.equal(f.counts().signatures, 1);
  assert.equal(f.wallet.state.signedTransactions[hash], 'signed-test-only');
  f.signer.receipt = async () => ({ status: 1 }); assert.equal((await f.auto.check(item.id)).status, 'completed');
});
test('signing failure is recoverable without ever broadcasting; reserved spend not silently released', async () => {
  const f = fixture({ sign: async () => { throw new Error('signing failed'); } }); f.auto.enable(policy);
  await assert.rejects(f.auto.execute(input)); const item = f.wallet.state.intents[0]; assert.equal(item.status, 'signing');
  assert.equal((await f.auto.recover(item.id)).status, 'cancelled_before_broadcast'); assert.equal(f.wallet.state.policy.spent, '2000');
});
test('restart disables autonomy and retains the previous budget', () => {
  const f = fixture(); f.auto.enable(policy); f.wallet.state.policy.spent = '2000';
  new AutonomousPayments(f.wallet, f.signer); assert.equal(f.wallet.state.policy.active, false); assert.equal(f.wallet.state.policy.spent, '2000');
});
test('owner authentication rejects missing/wrong password and rate limits attempts', () => {
  const guard = ownerGuard('correct-password-123'); let passed = false, status;
  const res = { status: code => { status = code; return res; }, json: () => res };
  guard({ get: () => 'correct-password-123' }, res, () => { passed = true; }); assert.equal(passed, true);
  for (let i = 0; i < 5; i++) guard({ get: () => 'bad' }, res, () => assert.fail());
  assert.equal(status, 403); guard({ get: () => 'correct-password-123' }, res, () => assert.fail()); assert.equal(status, 429);
});
test('owner withdrawals use an idempotency key and block changed input', async () => {
  const f = fixture(); const args = { requestId: 'withdraw_001', recipient: payTo, token: 'USDG', amount: '0.001', gasLimit: '0.00001' };
  const item = await f.auto.withdraw(args); assert.equal(item.kind, 'withdrawal'); assert.equal(item.status, 'completed');
  await f.auto.withdraw(args); assert.equal(f.counts().signatures, 1);
  await assert.rejects(f.auto.withdraw({ ...args, amount: '0.002' }), /different input/);
});
function adapterFixture() {
  const tokenInterface = new ethers.Interface(['function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)']);
  const provider = { send: async () => '0x1237', getCode: async () => '0x6000',
    call: async tx => tx.data.startsWith(tokenInterface.getFunction('decimals').selector)
      ? tokenInterface.encodeFunctionResult('decimals', [6]) : tokenInterface.encodeFunctionResult('balanceOf', [1000000n]),
    getFeeData: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }), estimateGas: async () => 50000n,
    getBalance: async () => 1000000000000000000n, getTransactionCount: async () => 5 };
  return { provider, signer: new OlanasRobinhoodSigner({ wallet: privateTestWallet, provider, chain }) };
}
test('Olanas signs an exact Robinhood ERC20 transaction, not Base/Polygon/Solana', async () => {
  const f = adapterFixture(); const { transaction, gasCost } = await f.signer.prepare({ token: 'USDG', payTo, amount: '2000' }, '1000000');
  assert.equal(transaction.chainId, 4663n); assert.equal(transaction.to, tokenAddress); assert.equal(transaction.nonce, 5); assert.equal(gasCost, 120000n);
  const signed = await f.signer.sign(transaction); const parsed = ethers.Transaction.from(signed.raw);
  assert.equal(parsed.from, address); assert.equal(parsed.unsignedSerialized, transaction.unsignedSerialized);
});
test('adapter rejects wrong RPC network, excessive gas and tampered local signatures', async () => {
  const f = adapterFixture(); f.provider.send = async () => '0x2105'; await assert.rejects(f.signer.prepare({ token: 'ETH', payTo, amount: '1' }, '1000000'), /wrong chain/);
  f.provider.send = async () => '0x1237'; await assert.rejects(f.signer.prepare({ token: 'ETH', payTo, amount: '1' }, '1'), /gas limit/);
  const { transaction } = await f.signer.prepare({ token: 'ETH', payTo, amount: '1' }, '1000000');
  f.signer.wallet = { address, signTransaction: async () => {
    const changed = ethers.Transaction.from(transaction.unsignedSerialized); changed.value = 9n;
    changed.signature = privateTestWallet.signingKey.sign(changed.unsignedHash); return changed.serialized;
  } };
  await assert.rejects(f.signer.sign(transaction), /different transaction/);
});
test('Olanas stdio tools cannot configure budgets or withdraw; owner HTTP routes require separate authentication', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olanas-cdp-test-'));
  const keystore = path.join(dir, 'wallet.json');
  fs.writeFileSync(keystore, await privateTestWallet.encrypt('owner-test-password'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('payments-mcp/server.js')], stderr: 'pipe',
    env: { ...process.env, PAYMENTS_MCP_PORT: '14783', PAYMENTS_DATA_DIR: dir, ROBINHOOD_NETWORK: 'mainnet', X402_DEMO_MODE: 'false',
      PAYMENTS_WALLET_PROVIDER: 'olanas', OLANAS_KEYSTORE_FILE: keystore,
      OLANAS_ACCOUNT_ADDRESS: address, PAYMENTS_OWNER_PASSWORD: 'owner-test-password' } });
  const client = new Client({ name: 'cdp-test', version: '1' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools; assert.equal(tools.length, 7);
    assert.ok(!tools.some(tool => /withdraw|enable|session|owner|sign_transaction/.test(tool.name)));
    const result = await client.callTool({ name: 'show_wallet', arguments: {} }); const { walletUrl } = JSON.parse(result.content[0].text);
    const url = new URL(walletUrl); const headers = { authorization: 'Bearer ' + url.hash.slice(1), 'content-type': 'application/json' };
    const state = await (await fetch(url.origin + '/api/state', { headers })).json();
    assert.equal(state.walletProvider, 'olanas'); assert.equal(state.address, address); assert.equal(state.signedTransactions, undefined);
    assert.equal((await fetch(url.origin + '/api/owner/session', { method: 'POST', headers, body: JSON.stringify(policy) })).status, 403);
    assert.equal((await fetch(url.origin + '/api/owner/withdraw', { method: 'POST', headers, body: '{}' })).status, 403);
    const enabled = await fetch(url.origin + '/api/owner/session', { method: 'POST', headers: { ...headers, 'x-owner-password': 'owner-test-password' }, body: JSON.stringify(policy) });
    assert.equal(enabled.status, 200); assert.equal((await enabled.json()).active, true);
    const revoked = await fetch(url.origin + '/api/owner/revoke', { method: 'POST', headers: { ...headers, 'x-owner-password': 'owner-test-password' }, body: '{}' });
    assert.equal(revoked.status, 200);
    assert.equal((await (await fetch(url.origin + '/api/state', { headers })).json()).policy.active, false);
  } finally { await client.close(); fs.rmSync(dir, { recursive: true }); }
});
