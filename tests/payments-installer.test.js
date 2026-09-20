'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { parseArgs } = require('../payments-mcp/cli');

test('installer parses supported clients and automation flags', () => {
  const options = parseArgs(['install', '--client', 'codex', '--auto-config', '--force', '--network', 'testnet',
    '--launchpad', 'http://localhost:4021']);
  assert.equal(options.client, 'codex');
  assert.equal(options.autoConfig, true);
  assert.equal(options.force, true);
  assert.equal(options.network, 'testnet');
  assert.throws(() => parseArgs(['install', '--client', 'unknown']));
  assert.throws(() => parseArgs(['install', '--launchpad', 'https://example.com/path']));
});

test('installer creates, serves, reuses, and preserves a native wallet on uninstall', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'olanas-installer-test-'));
  const dir = path.join(base, '.olanas-payments-mcp');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, [path.resolve('payments-mcp/cli.js'), ...args], {
    cwd: path.resolve('.'), encoding: 'utf8', env: { ...process.env, OLANAS_INSTALL_DIR: dir }
  });
  const first = run(['install', '--client', 'other', '--no-auto-config']);
  assert.equal(first.status, 0, first.stderr);
  const initial = JSON.parse(fs.readFileSync(path.join(dir, 'install.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(dir, 'wallet.json')));
  assert.ok(fs.existsSync(path.join(dir, 'runtime', 'bundle.js')));
  const second = run(['install', '--client', 'other', '--no-auto-config', '--force']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'install.json'), 'utf8')).address, initial.address);
  const port = String(20000 + process.pid % 10000);
  const server = spawn(process.execPath, ['--env-file=' + path.join(dir, 'payments.env'),
    path.join(dir, 'runtime', 'bundle.js'), '--wallet-only'], {
    cwd: path.resolve('.'), stdio: 'ignore', env: { ...process.env, PAYMENTS_MCP_PORT: port,
      PAYMENTS_DATA_DIR: path.join(dir, 'test-data') }
  });
  t.after(() => { if (!server.killed) server.kill(); });
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { response = await fetch('http://127.0.0.1:' + port + '/'); if (response.ok) break; }
    catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(response?.status, 200);
  assert.match(await response.text(), /Olanas Payments/);
  server.kill();
  const removed = run(['uninstall']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'runtime')), false);
  assert.equal(fs.existsSync(path.join(dir, 'wallet.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'owner-password.txt')), true);
});
