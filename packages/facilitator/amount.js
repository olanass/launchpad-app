const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN_CONFIG: config } = require('./config');
function parseAmount(value, symbol) {
  const token = typeof symbol === 'string' && Object.hasOwn(config.supportedTokens, symbol) ? config.supportedTokens[symbol] : null;
  if (!token) throw new Error('Unsupported currency');
  if (typeof value !== 'string' || value.length > 80 || !/^\d+(\.\d+)?$/.test(value)) throw new Error('Price must be a positive decimal string');
  const units = ethers.parseUnits(value, token.decimals);
  if (units <= 0n || units >= 2n ** 256n) throw new Error('Price is out of range');
  return units;
}
module.exports = { parseAmount };

