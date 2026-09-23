'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.TURSO_DATABASE_URL = 'file::memory:';
const { SqlChannelStorage } = require('../src/server/inference/channel-storage');
const { serviceStore } = require('../src/server/services/store');

test('escrow channel state persists and updates atomically', async () => {
  const first = new SqlChannelStorage();
  const second = new SqlChannelStorage();
  const key = '0xABC';
  try {
    assert.equal(await first.get(key), undefined);
    assert.deepEqual(await first.updateChannel(key, current => ({ balance: '2000000', chargedCumulativeAmount: '0', version: (current?.version || 0) + 1 })), {
      channel: { balance: '2000000', chargedCumulativeAmount: '0', version: 1 }, status: 'updated'
    });
    const attempts = Array.from({ length: 20 }, () => second.updateChannel(key, current => ({ ...current, version: current.version + 1 })));
    await Promise.all(attempts);
    assert.equal((await first.get(key)).version, 21);
    assert.equal((await first.list()).length, 1);
    assert.equal((await second.updateChannel(key, current => current)).status, 'unchanged');
    assert.equal((await second.updateChannel(key, () => undefined)).status, 'deleted');
    assert.equal(await first.get(key), undefined);
  } finally {
    await serviceStore.close();
  }
});
