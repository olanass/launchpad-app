const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../config/paths');
const directory = path.join(DATA_DIR, 'redemptions');
function filename(key) { return path.join(directory, crypto.createHash('sha256').update(key).digest('hex') + '.json'); }
function isRedeemed(key) { return fs.existsSync(filename(key)); }
function getRedemption(key) {
  try { return JSON.parse(fs.readFileSync(filename(key), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function listRedemptions() {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(directory, f), 'utf8')));
}
function redeem(key, receipt) {
  if (!key) throw new Error('Missing payment redemption key');
  fs.mkdirSync(directory, { recursive: true });
  // Exclusive creation is the commit point, including across processes.
  try { fs.writeFileSync(filename(key), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
  catch (err) {
    if (err.code === 'EEXIST') throw new Error('Payment has already been redeemed');
    throw err;
  }
}
module.exports = { isRedeemed, redeem, getRedemption, listRedemptions };

