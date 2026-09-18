const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const crypto = require('crypto');
const { ROBINHOOD_CHAIN_CONFIG: config } = require('../config/chain');
const { DATA_DIR } = require('../config/paths');
const { parseAmount } = require('../facilitator/amount');
const { createProvider } = require('../facilitator/verifier');
const PAYWALLS_FILE = path.join(DATA_DIR, 'paywalls.json');
class PaywallService {
  constructor() {
    this.paywalls = new Map();
    if (fs.existsSync(PAYWALLS_FILE)) {
      // A corrupt database must not be silently overwritten.
      for (const item of JSON.parse(fs.readFileSync(PAYWALLS_FILE, 'utf8'))) this.paywalls.set(item.paywallId, item);
    }
  }
  savePaywalls() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = PAYWALLS_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify([...this.paywalls.values()], null, 2), { mode: 0o600 });
    fs.renameSync(temp, PAYWALLS_FILE);
  }
  async getRealGasEstimate() {
    if (config.demoMode) return this.fallbackEstimate();
    if (this.gasCache && Date.now() - this.gasCache.time < 15000) return this.gasCache.value;
    if (this.gasPending) return this.gasPending;
    this.gasPending = (async () => {
      const provider = createProvider();
      try {
        const [fees, blockNumber, network] = await Promise.all([provider.getFeeData(), provider.getBlockNumber(), provider.getNetwork()]);
        if (Number(network.chainId) !== config.chainId || fees.gasPrice == null) throw new Error('Gas quote unavailable');
        const value = {
          chainId: config.chainId, chainName: config.name, blockNumber,
          gasPriceGwei: ethers.formatUnits(fees.gasPrice, 'gwei'), gasPriceWei: fees.gasPrice.toString(),
          gasUnits: 65000, totalFeeEth: ethers.formatEther(fees.gasPrice * 65000n),
          totalFeeUsd: null, formattedUsd: 'USD quote unavailable', isEstimated: true,
          source: 'rpc', timestamp: new Date().toISOString()
        };
        this.gasCache = { time: Date.now(), value };
        return value;
      } catch (_) { return this.fallbackEstimate(); }
      finally { provider.destroy(); }
    })();
    try { return await this.gasPending; } finally { this.gasPending = null; }
  }
  fallbackEstimate() {
    return { chainId: config.chainId, chainName: config.name, blockNumber: null, gasPriceGwei: null,
      totalFeeEth: null, totalFeeUsd: null, formattedUsd: 'Estimate unavailable', isEstimated: true, source: 'unavailable' };
  }
  async createPaywall(params) {
    const { title, description = '', price, currency, creatorAddress, creatorSignature, asset } = params;
    parseAmount(price, currency);
    if ([...this.paywalls.values()].some(p => p.creatorSignature === creatorSignature)) throw Object.assign(new Error('Creation signature already used'), { status: 400 });
    const paywall = {
      paywallId: 'pay_' + crypto.randomBytes(12).toString('hex'), title, description, price,
      currency, creatorAddress: ethers.getAddress(creatorAddress.toLowerCase()), creatorSignature,
      asset: { ...asset, filePath: undefined }, gasEstimate: this.fallbackEstimate(),
      viewsCount: 0, salesCount: 0, totalEarned: '0', totalEarnedUsd: 0, createdAt: new Date().toISOString()
    };
    this.paywalls.set(paywall.paywallId, paywall);
    try { this.savePaywalls(); } catch (err) { this.paywalls.delete(paywall.paywallId); throw err; }
    return paywall;
  }
  getPaywall(id) { return this.paywalls.get(id) || null; }
  getPaywallsByCreator(address) {
    return [...this.paywalls.values()].filter(p => p.creatorAddress.toLowerCase() === address.toLowerCase());
  }
  recordSale(id, amount) {
    const p = this.paywalls.get(id);
    if (!p) return;
    const decimals = config.supportedTokens[p.currency].decimals;
    p.totalEarned = ethers.formatUnits(ethers.parseUnits(p.totalEarned || '0', decimals) + parseAmount(amount, p.currency), decimals);
    p.totalEarnedUsd = p.currency === 'USDC' ? Number(p.totalEarned) : null;
    p.salesCount++;
    this.savePaywalls();
  }
}
function publicPaywall(p) {
  return {
    paywallId: p.paywallId, title: p.title, description: p.description, price: p.price, currency: p.currency,
    creatorAddress: p.creatorAddress, createdAt: p.createdAt, viewsCount: p.viewsCount, salesCount: p.salesCount,
    totalEarned: p.totalEarned || '0', totalEarnedUsd: p.totalEarnedUsd,
    asset: { originalName: p.asset.originalName, fileSize: p.asset.fileSize, formattedSize: p.asset.formattedSize,
      mimeType: p.asset.mimeType, extension: p.asset.extension, preview: '[Protected content — payment required]' }
  };
}
const paywallService = new PaywallService();
module.exports = { paywallService, publicPaywall };

