'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { ethers } = require('ethers');
const { encode, save, provision, registrationArgs } = require('../payments-mcp/setup');
const address = '0x1111111111111111111111111111111111111111';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olanas-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, env: { OLANAS_KEYSTORE_FILE: path.join(dir, 'wallet.json'),
    PAYMENTS_OWNER_PASSWORD: 'owner-password-test', ROBINHOOD_NETWORK: 'testnet',
    PAYMENTS_LAUNCHPAD_URL: 'http://localhost:4021' } };
}

test('setup env values round trip without expanding secrets', () => {
  const doubleQuote = 'a' + String.fromCharCode(34) + 'b';
  for (const value of ['abc#def', 'with spaces', 'line1\nline2', doubleQuote, '$TOKEN']) {
    assert.equal(parseEnv('VALUE=' + encode(value)).VALUE, value);
  }
  assert.throws(() => encode(String.fromCharCode(0)));
  assert.throws(() => encode(String.fromCharCode(39) + String.fromCharCode(34)));
});

test('setup preserves other configuration and safely overrides old values', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'payments.env');
  save(file, '# preserve comment\nOTHER=value\nOLANAS_ACCOUNT_ADDRESS=old\n', { OLANAS_ACCOUNT_ADDRESS: address });
  const result = fs.readFileSync(file, 'utf8');
  assert.ok(result.includes('# preserve comment'));
  assert.equal(parseEnv(result).OTHER, 'value');
  assert.equal(parseEnv(result).OLANAS_ACCOUNT_ADDRESS, address);
  assert.equal(fs.existsSync(file + '.setup-tmp'), false);
});

test('first setup creates an encrypted local wallet and reruns reuse it', async t => {
  const { env } = fixture(t);
  const source = ethers.Wallet.createRandom();
  assert.equal(await provision(env, () => source), source.address);
  const encrypted = fs.readFileSync(env.OLANAS_KEYSTORE_FILE, 'utf8');
  assert.ok(!encrypted.includes(source.privateKey));
  assert.equal((await ethers.Wallet.fromEncryptedJson(encrypted, env.PAYMENTS_OWNER_PASSWORD)).address, source.address);
  assert.equal(await provision({ ...env, OLANAS_ACCOUNT_ADDRESS: source.address }), source.address);
});

test('invalid setup is rejected before wallet creation', async t => {
  const { env } = fixture(t);
  let count = 0;
  for (const change of [{ ROBINHOOD_NETWORK: 'base' }, { OLANAS_KEYSTORE_FILE: '' },
    { PAYMENTS_OWNER_PASSWORD: 'short' }, { PAYMENTS_LAUNCHPAD_URL: 'http://example.com' },
    { PAYMENTS_LAUNCHPAD_URL: 'https://example.com/path' }]) {
    await assert.rejects(provision({ ...env, ...change }, () => { count++; return ethers.Wallet.createRandom(); }));
  }
  assert.equal(count, 0);
});

test('refuses an unexpected saved account address', async t => {
  const { env } = fixture(t);
  const wallet = ethers.Wallet.createRandom();
  await provision(env, () => wallet);
  await assert.rejects(provision({ ...env, OLANAS_ACCOUNT_ADDRESS: address }), /mismatch/);
});

test('Codex registration uses absolute file paths without passing credentials', () => {
  const file = path.resolve('path with spaces', 'payments.env');
  const args = registrationArgs(file);
  assert.deepEqual(args.slice(0, 4), ['mcp', 'add', 'olanas-payments', '--']);
  assert.equal(args[4], process.execPath);
  assert.equal(args[5], '--env-file=' + file);
  assert.ok(path.isAbsolute(args[6]));
  assert.ok(!args.join(' ').includes('PAYMENTS_OWNER_PASSWORD'));
});
