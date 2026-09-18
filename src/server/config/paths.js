const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_DIR = path.join(PROJECT_ROOT, 'src', 'client');
const isTestnet = process.env.ROBINHOOD_NETWORK?.toLowerCase() === 'testnet';
const configuredDataDirectory = isTestnet ? process.env.ROBINHOOD_TESTNET_DATA_DIR : process.env.X402_DATA_DIR;
const defaultDataDirectory = isTestnet ? 'uploads-testnet' : 'uploads';
const DATA_DIR = path.resolve(configuredDataDirectory || path.join(PROJECT_ROOT, defaultDataDirectory));

module.exports = { PROJECT_ROOT, CLIENT_DIR, DATA_DIR };
