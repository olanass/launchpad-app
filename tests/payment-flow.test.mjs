import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeOrderPayment } from '../app/payment-flow.mjs';

function fixture() {
  const actions = [];
  const payer = '0x1111111111111111111111111111111111111111';
  const args = {
    order: { approvalStatus: 'pending', paymentStatus: 'unpaid', quote: { chainId: 4663, version: 1, token: 'USDG', asset: '0x3333333333333333333333333333333333333333',
      amount: '2000', displayAmount: '0.002', decimals: 6, recipient: '0x2222222222222222222222222222222222222222' } },
    provider: { getNetwork: async () => ({ chainId: 4663 }), getBalance: async () => 1000000000000000000n, getCode: async () => '0x1234' },
    signer: { getAddress: async () => payer, signMessage: async () => { actions.push('sign'); return 'signature'; }, sendTransaction: async () => { actions.push('transfer'); return { hash: '0xoriginal' }; } },
    contractFactory: () => ({ decimals: async () => 6, balanceOf: async () => 10000n, transfer: async (recipient, amount) => {
      assert.equal(recipient, args.order.quote.recipient); assert.equal(amount, 2000n);
      actions.push('transfer'); return { hash: '0xoriginal' };
    } }),
    mutate: async action => { actions.push(action); return { message: 'exact order', quoteVersion: 1 }; },
    saveHash: hash => { assert.equal(hash, '0xoriginal'); actions.push('saveHash'); }
  };
  return { args, actions };
}
test('website wallet: approves before transferring and saves the original hash before submission', async () => {
  const { args, actions } = fixture(); await executeOrderPayment(args);
  assert.deepEqual(actions, ['approval-message', 'sign', 'approve', 'transfer', 'saveHash', 'payment', 'reconcile']);
});
test('website wallet: rejected signature and conflicting server approval never transfer', async () => {
  for (const failure of ['sign', 'approve']) {
    const { args, actions } = fixture();
    if (failure === 'sign') args.signer.signMessage = async () => { throw Error('user rejected'); };
    else args.mutate = async action => { if (action === 'approve') throw Error('another tab already approved'); return { message: 'exact order', quoteVersion: 1 }; };
    await assert.rejects(executeOrderPayment(args)); assert.ok(!actions.includes('transfer'));
  }
});
test('website wallet: wrong network, invalid token and altered quote fail before signing', async () => {
  for (const change of [
    args => { args.provider.getNetwork = async () => ({ chainId: 1 }); },
    args => { args.provider.getCode = async () => '0x'; },
    args => { args.order.quote.decimals = 18; },
    args => { args.order.quote.amount = '1'; },
    args => { args.provider.getBalance = async () => 0n; },
    args => { args.order.approvalStatus = 'approved'; }
  ]) {
    const { args, actions } = fixture(); change(args); await assert.rejects(executeOrderPayment(args));
    assert.ok(!actions.includes('sign')); assert.ok(!actions.includes('transfer'));
  }
});
test('website wallet: a post-transfer network failure preserves the hash and never retries payment', async () => {
  const { args, actions } = fixture();
  args.mutate = async action => { actions.push(action); if (action === 'payment') throw Error('network lost'); return { message: 'exact order', quoteVersion: 1 }; };
  await assert.rejects(executeOrderPayment(args), /network lost/);
  assert.equal(actions.filter(a => a === 'transfer').length, 1);
  assert.ok(actions.indexOf('saveHash') < actions.indexOf('payment'));
});
test('website wallet: network changes after signing stop the transfer', async () => {
  const { args, actions } = fixture(); let checks = 0;
  args.provider.getNetwork = async () => ({ chainId: checks++ ? 1 : 4663 });
  await assert.rejects(executeOrderPayment(args), /network changed/); assert.ok(!actions.includes('transfer'));
});
