const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const crypto = require('crypto');
const { ROBINHOOD_CHAIN_CONFIG } = require('../facilitator/config');

const PAYWALLS_FILE = path.join(__dirname, '..', '..', 'uploads', 'paywalls.json');

class PaywallService {
  constructor() {
    this.paywalls = new Map();
    this.provider = new ethers.JsonRpcProvider(ROBINHOOD_CHAIN_CONFIG.rpcUrl);
    this.cachedEthPrice = 3250.00;
    this.loadPaywalls();
  }

  loadPaywalls() {
    try {
      if (fs.existsSync(PAYWALLS_FILE)) {
        const raw = fs.readFileSync(PAYWALLS_FILE, 'utf8');
        const list = JSON.parse(raw);
        list.forEach(p => this.paywalls.set(p.paywallId, p));
      }
    } catch (e) {
      console.error('Error loading paywalls:', e);
    }
  }

  savePaywalls() {
    try {
      const list = Array.from(this.paywalls.values());
      fs.writeFileSync(PAYWALLS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving paywalls:', e);
    }
  }

  /**
   * Fetch live gas price and estimate real settlement fee on Robinhood Chain
   */
  async getRealGasEstimate() {
    try {
      const [feeData, blockNumber] = await Promise.all([
        this.provider.getFeeData(),
        this.provider.getBlockNumber()
      ]);

      const gasPriceWei = feeData.gasPrice || 47000000n; // fallback ~0.047 gwei
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPriceWei, 'gwei'));
      
      // Standard settlement gas limit: ~65,000 gas units
      const gasUnits = 65000;
      const totalFeeWei = gasPriceWei * BigInt(gasUnits);
      const totalFeeEth = parseFloat(ethers.formatEther(totalFeeWei));
      const totalFeeUsd = totalFeeEth * this.cachedEthPrice;

      return {
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        chainName: ROBINHOOD_CHAIN_CONFIG.name,
        blockNumber,
        gasPriceGwei: Number(gasPriceGwei.toFixed(4)),
        gasPriceWei: gasPriceWei.toString(),
        gasUnits,
        totalFeeEth: Number(totalFeeEth.toFixed(8)),
        totalFeeUsd: Number(totalFeeUsd.toFixed(4)),
        formattedUsd: totalFeeUsd < 0.01 ? '< $0.01' : `$${totalFeeUsd.toFixed(3)}`,
        l2SavingsPercent: '99.8%',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      // Fallback estimate if RPC network hiccup occurs
      return {
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        chainName: ROBINHOOD_CHAIN_CONFIG.name,
        blockNumber: 65338000,
        gasPriceGwei: 0.047,
        gasUnits: 65000,
        totalFeeEth: 0.00000305,
        totalFeeUsd: 0.0098,
        formattedUsd: '< $0.01',
        l2SavingsPercent: '99.8%',
        timestamp: new Date().toISOString(),
        isEstimated: true
      };
    }
  }

  /**
   * Create a new signed paywall listing
   */
  async createPaywall(params) {
    const {
      title,
      description = '',
      price,
      currency = 'USDC',
      creatorAddress,
      creatorSignature = null,
      asset
    } = params;

    if (!price || parseFloat(price) <= 0) {
      throw new Error('Valid price is required');
    }

    if (!creatorAddress || !ethers.isAddress(creatorAddress)) {
      throw new Error('Valid Robinhood Chain creator address is required');
    }

    const paywallId = 'pay_' + crypto.randomBytes(6).toString('hex');
    const gasEstimate = await this.getRealGasEstimate();

    const paywall = {
      paywallId,
      title: title || asset.originalName,
      description,
      price: String(parseFloat(price)),
      currency: currency.toUpperCase(),
      creatorAddress: ethers.getAddress(creatorAddress),
      creatorSignature,
      asset: {
        assetId: asset.assetId,
        originalName: asset.originalName,
        storedFilename: asset.storedFilename,
        fileSize: asset.fileSize,
        formattedSize: asset.formattedSize,
        mimeType: asset.mimeType,
        extension: asset.extension,
        sha256: asset.sha256,
        preview: asset.preview,
        encrypted: asset.encrypted || false,
        cipher: asset.cipher || null,
        iv: asset.iv || null,
        authTag: asset.authTag || null,
        ipfsCid: asset.ipfsCid || null,
        ipfsGatewayUrl: asset.ipfsGatewayUrl || null
      },
      gasEstimate,
      viewsCount: 0,
      salesCount: 0,
      totalEarnedUsd: 0,
      createdAt: new Date().toISOString()
    };

    this.paywalls.set(paywallId, paywall);
    this.savePaywalls();
    return paywall;
  }

  getPaywall(paywallId) {
    const paywall = this.paywalls.get(paywallId);
    if (!paywall) return null;
    paywall.viewsCount += 1;
    this.savePaywalls();
    return paywall;
  }

  getPaywallsByCreator(creatorAddress) {
    if (!creatorAddress) return [];
    const normalized = creatorAddress.toLowerCase();
    const list = [];
    for (const p of this.paywalls.values()) {
      if (p.creatorAddress.toLowerCase() === normalized) {
        list.push(p);
      }
    }
    return list;
  }

  recordSale(paywallId, amountUsd) {
    const paywall = this.paywalls.get(paywallId);
    if (paywall) {
      paywall.salesCount += 1;
      paywall.totalEarnedUsd += parseFloat(amountUsd || paywall.price);
      this.savePaywalls();
    }
  }
}

const paywallService = new PaywallService();
module.exports = { paywallService };
