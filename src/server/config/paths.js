const path = require('path');
const os = require('os');

const PROJECT_ROOT = process.cwd();
const CLIENT_DIR = path.join(PROJECT_ROOT, 'src', 'client');
const GENERATED_DIR = path.join(CLIENT_DIR, 'generated');
const DATA_DIR = path.resolve(process.env.X402_DATA_DIR || (process.env.VERCEL
  ? path.join(os.tmpdir(), 'x402-mainnet')
  : path.join(PROJECT_ROOT, 'uploads')));

module.exports = { PROJECT_ROOT, CLIENT_DIR, GENERATED_DIR, DATA_DIR };
