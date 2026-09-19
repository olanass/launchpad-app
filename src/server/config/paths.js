const path = require('path');
const os = require('os');

const PROJECT_ROOT = process.cwd();
const CLIENT_DIR = path.join(PROJECT_ROOT, 'src', 'client');
const GENERATED_DIR = path.join(CLIENT_DIR, 'generated');
const isTestnet = process.env.ROBINHOOD_NETWORK?.toLowerCase() === 'testnet';
const configuredDataDirectory = isTestnet ? process.env.ROBINHOOD_TESTNET_DATA_DIR : process.env.X402_DATA_DIR;
const defaultDataDirectory = isTestnet ? 'uploads-testnet' : 'uploads';
const DATA_DIR = path.resolve(configuredDataDirectory || (process.env.VERCEL
  ? path.join(os.tmpdir(), isTestnet ? 'x402-testnet' : 'x402-mainnet')
  : path.join(PROJECT_ROOT, defaultDataDirectory)));

module.exports = { PROJECT_ROOT, CLIENT_DIR, GENERATED_DIR, DATA_DIR };
