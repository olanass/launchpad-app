/**
 * In-memory ledger and analytics store for x402 Facilitator
 */

class FacilitatorStore {
  constructor() {
    this.receipts = new Map();
    this.events = [];
    this.merchants = new Map();
    this.stats = {
      totalVolumeUsd: 0,
      totalSettlements: 0,
      totalFacilitatorFeesUsd: 0,
      activeAgents: new Set(),
      startTime: Date.now()
    };

    // Pre-populate demo merchants
    this.registerMerchant({
      id: 'mch_pulse_ai',
      name: 'Robinhood Pulse AI',
      recipient: '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b',
      endpoints: [
        { path: '/api/v1/market/robinhood-pulse', price: '0.002', token: 'USDC', description: 'Real-time Robinhood Chain market telemetry' },
        { path: '/api/v1/agent/inference', price: '0.005', token: 'USDC', description: 'Agent LLM compute & predictive analysis' }
      ]
    });

    this.registerMerchant({
      id: 'mch_pons_alpha',
      name: 'Pons Token Alpha Scanner',
      recipient: '0x9965507d1a55bcc2695c58ba16Fb37D819b0A4dF',
      endpoints: [
        { path: '/api/v1/agent/task-runner', price: '0.010', token: 'USDC', description: 'Deep audit of newly created Pons bonding curves' }
      ]
    });
  }

  registerMerchant(merchantData) {
    const id = merchantData.id || ('mch_' + Math.random().toString(36).substring(2, 9));
    const merchant = {
      id,
      name: merchantData.name || 'Unnamed API Merchant',
      recipient: merchantData.recipient,
      totalEarnedUsd: 0,
      totalCalls: 0,
      endpoints: merchantData.endpoints || [],
      registeredAt: new Date().toISOString()
    };
    this.merchants.set(id, merchant);
    return merchant;
  }

  getMerchants() {
    return Array.from(this.merchants.values());
  }

  recordReceipt(receipt) {
    if (this.receipts.has(receipt.receiptId)) return this.receipts.get(receipt.receiptId);
    this.receipts.set(receipt.receiptId, receipt);

    // Update stats
    const amountUsd = receipt.token === 'USDC' && !receipt.isSimulated ? parseFloat(receipt.amount) : 0;
    const feeUsd = receipt.token === 'USDC' && !receipt.isSimulated ? parseFloat(receipt.facilitatorFee) : 0;

    this.stats.totalVolumeUsd += amountUsd;
    this.stats.totalSettlements += 1;
    this.stats.totalFacilitatorFeesUsd += feeUsd;
    this.stats.activeAgents.add(receipt.payer.toLowerCase());

    // Update merchant earnings
    for (const merchant of this.merchants.values()) {
      if (merchant.recipient.toLowerCase() === receipt.recipient.toLowerCase()) {
        merchant.totalEarnedUsd += amountUsd;
        merchant.totalCalls += 1;
        break;
      }
    }

    // Add to activity events (keep last 50)
    const event = {
      type: 'settlement',
      receiptId: receipt.receiptId,
      payer: receipt.payer,
      recipient: receipt.recipient,
      amount: receipt.amount,
      token: receipt.token,
      txHash: receipt.txHash,
      timestamp: receipt.settledAt,
      endpoint: receipt.metadata?.endpoint || '/api'
    };

    this.events.unshift(event);
    if (this.events.length > 50) {
      this.events.pop();
    }

    return receipt;
  }

  getReceipt(receiptId) {
    return this.receipts.get(receiptId);
  }

  getRecentEvents(limit = 20) {
    return this.events.slice(0, limit);
  }

  getAnalytics() {
    return {
      network: 'Robinhood Chain',
      chainId: 4663,
      totalVolumeUsd: Number(this.stats.totalVolumeUsd.toFixed(4)),
      totalSettlements: this.stats.totalSettlements,
      totalFacilitatorFeesUsd: Number(this.stats.totalFacilitatorFeesUsd.toFixed(6)),
      uniqueAgentsCount: this.stats.activeAgents.size,
      activeMerchantsCount: this.merchants.size,
      uptimeSeconds: Math.floor((Date.now() - this.stats.startTime) / 1000)
    };
  }
}

const store = new FacilitatorStore();
for (const receipt of require('./redemptions').listRedemptions()) store.recordReceipt(receipt);
module.exports = { store };
