const express = require('express');
const os = require('os');
const path = require('path');
const { loadEnv } = require('./src/server/config/load-env');

loadEnv();

if (process.env.VERCEL) {
  const network = process.env.ROBINHOOD_NETWORK?.toLowerCase() === 'testnet' ? 'testnet' : 'mainnet';
  const temporaryDataDirectory = path.join(os.tmpdir(), `x402-${network}`);

  if (network === 'testnet' && !process.env.ROBINHOOD_TESTNET_DATA_DIR) {
    process.env.ROBINHOOD_TESTNET_DATA_DIR = temporaryDataDirectory;
  }
  if (network === 'mainnet' && !process.env.X402_DATA_DIR) {
    process.env.X402_DATA_DIR = temporaryDataDirectory;
  }
}

const app = express();
app.use(require('./src/server/app'));

module.exports = app;