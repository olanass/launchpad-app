'use strict';
// UI-only fixture. A throwaway encrypted key + local mock RPC cannot
// broadcast a real transaction. Never use this configuration for actual funds.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const rpc = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      const reply = input => ({ jsonrpc: '2.0', id: input.id, ...(input.method === 'eth_chainId' ? { result: '0xb626' }
        : input.method === 'eth_getBalance' ? { result: '0x0' } : { error: { code: -32601, message: 'Preview only; method disabled' } }) });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(reply) : reply(parsed)));
    } catch (_) { res.writeHead(400); res.end(); }
  });
});
rpc.listen(0, '127.0.0.1', async () => {
  const dataDir = path.resolve('.local/payments-olanas-preview');
  const keystore = path.join(dataDir, 'wallet.json');
  const wallet = new ethers.Wallet('0x' + '12'.repeat(32));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keystore, await wallet.encrypt('preview-only-password'));
  Object.assign(process.env, { PAYMENTS_WALLET_PROVIDER: 'olanas', OLANAS_KEYSTORE_FILE: keystore,
    OLANAS_ACCOUNT_ADDRESS: wallet.address, PAYMENTS_OWNER_PASSWORD: 'preview-only-password', ROBINHOOD_NETWORK: 'testnet',
    ROBINHOOD_TESTNET_RPC_URL: 'http://127.0.0.1:' + rpc.address().port, PAYMENTS_MCP_PORT: '14784',
    PAYMENTS_DATA_DIR: dataDir, X402_DEMO_MODE: 'false' });
  process.argv.push('--wallet-only');
  require('../../payments-mcp/server');
});
