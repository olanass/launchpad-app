const { loadEnv } = require('../src/server/config/load-env');

loadEnv();

const network = (process.argv[2] || process.env.ROBINHOOD_NETWORK || 'mainnet').toLowerCase();
if (!['mainnet', 'testnet'].includes(network)) {
  throw new Error('Network must be "mainnet" or "testnet"');
}

process.env.ROBINHOOD_NETWORK = network;
const scopedRpcKey = network === 'testnet' ? 'ROBINHOOD_TESTNET_RPC_URL' : 'ROBINHOOD_MAINNET_RPC_URL';
const defaultRpc = network === 'testnet'
  ? 'https://rpc.testnet.chain.robinhood.com'
  : 'https://rpc.mainnet.chain.robinhood.com';
process.env.ROBINHOOD_RPC_URL = process.env[scopedRpcKey] || defaultRpc;

process.env.NEXT_DEV = String(process.env.npm_lifecycle_event || '').startsWith('dev') ? 'true' : 'false';
require('../server');
