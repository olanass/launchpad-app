const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { DATA_DIR } = require('../config/paths');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const { parseAmount } = require('../facilitator/amount');

const SERVICES_FILE = path.join(DATA_DIR, 'services.json');
const LOGO_DIR = path.join(DATA_DIR, 'service-logos');

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'service';
}

function addAmount(left, right, currency) {
  const decimals = chain.supportedTokens[currency].decimals;
  return ethers.formatUnits(ethers.parseUnits(left || '0', decimals) + parseAmount(right, currency), decimals);
}

function publicService(service, baseUrl) {
  const gatewayPath = `/x402/${service.slug}`;
  return {
    serviceId: service.serviceId, slug: service.slug, name: service.name, description: service.description,
    category: service.category, videoUrl: service.videoUrl || null,
    logoUrl: service.logo ? `${baseUrl ? baseUrl.replace(/\/$/, '') : ''}/api/services/${encodeURIComponent(service.slug)}/logo` : null,
    allowedMethods: service.allowedMethods, price: service.price, currency: service.currency,
    network: service.network, chainId: service.chainId, creatorAddress: service.creatorAddress,
    payoutAddress: service.payoutAddress, status: service.status, requests: service.paidRequests,
    revenue: service.totalEarned, revenueUsd: service.currency === 'USDC' ? Number(service.totalEarned) : null,
    successfulResponses: service.successfulResponses, failedResponses: service.failedResponses,
    lastRequestAt: service.lastRequestAt, lastSuccessAt: service.lastSuccessAt,
    createdAt: service.createdAt, updatedAt: service.updatedAt, gatewayPath,
    gatewayUrl: baseUrl ? baseUrl.replace(/\/$/, '') + gatewayPath : gatewayPath
  };
}

class ServiceStore {
  constructor() {
    this.services = new Map();
    if (fs.existsSync(SERVICES_FILE)) {
      for (const service of JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf8'))) this.services.set(service.serviceId, service);
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = SERVICES_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify([...this.services.values()], null, 2), { mode: 0o600 });
    fs.renameSync(temporary, SERVICES_FILE);
  }

  create(input) {
    let slug = slugify(input.slug || input.name);
    if ([...this.services.values()].some(service => service.slug === slug)) slug += '-' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();
    const serviceId = 'svc_' + crypto.randomBytes(12).toString('hex');
    let logo = null;
    if (input.logo) {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[input.logo.mimeType];
      const storedName = `${serviceId}.${extension}`;
      fs.mkdirSync(LOGO_DIR, { recursive: true });
      const logoFile = path.join(LOGO_DIR, storedName);
      const temporaryLogo = logoFile + '.tmp';
      fs.writeFileSync(temporaryLogo, input.logo.buffer, { mode: 0o600 });
      fs.renameSync(temporaryLogo, logoFile);
      logo = { storedName, mimeType: input.logo.mimeType, hash: input.logo.hash };
    }
    const service = {
      serviceId, slug, name: input.name,
      description: input.description, category: input.category, videoUrl: input.videoUrl || '', logo, endpointUrl: input.endpointUrl,
      allowedMethods: input.allowedMethods, price: input.price, currency: input.currency,
      network: chain.networkId, chainId: chain.chainId,
      creatorAddress: ethers.getAddress(input.creatorAddress.toLowerCase()),
      payoutAddress: ethers.getAddress(input.payoutAddress.toLowerCase()),
      creatorSignature: input.creatorSignature, status: 'live', paidRequests: 0,
      successfulResponses: 0, failedResponses: 0, totalEarned: '0', lastRequestAt: null,
      lastSuccessAt: null, recentCalls: [], createdAt: now, updatedAt: now
    };
    this.services.set(service.serviceId, service);
    try { this.save(); }
    catch (error) {
      this.services.delete(service.serviceId);
      const logoPath = serviceLogoPath(service);
      if (logoPath && fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
      throw error;
    }
    return service;
  }

  getById(id) { return this.services.get(id) || null; }
  getBySlug(slug) { return [...this.services.values()].find(service => service.slug === slug) || null; }
  byCreator(address) { return [...this.services.values()].filter(service => service.creatorAddress.toLowerCase() === address.toLowerCase()); }
  hasCreationSignature(signature) { return [...this.services.values()].some(service => service.creatorSignature === signature); }

  list({ status, category, search, limit = 20, offset = 0 } = {}) {
    let services = [...this.services.values()];
    if (status) services = services.filter(service => service.status === status);
    if (category) services = services.filter(service => service.category.toLowerCase() === category.toLowerCase());
    if (search) {
      const query = search.toLowerCase();
      services = services.filter(service => `${service.name} ${service.description}`.toLowerCase().includes(query));
    }
    services.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { total: services.length, services: services.slice(offset, offset + limit) };
  }

  recordPayment(serviceId, receipt) {
    const service = this.getById(serviceId);
    if (!service || receipt.replayed) return;
    service.paidRequests += 1;
    service.totalEarned = addAmount(service.totalEarned, service.price, service.currency);
    service.lastRequestAt = new Date().toISOString();
    service.updatedAt = service.lastRequestAt;
    this.save();
  }

  recordResult(serviceId, result) {
    const service = this.getById(serviceId);
    if (!service) return;
    if (result.success) {
      service.successfulResponses += 1;
      service.lastSuccessAt = new Date().toISOString();
    } else service.failedResponses += 1;
    service.recentCalls.unshift({ receiptId: result.receiptId, status: result.status, latencyMs: result.latencyMs, success: result.success, timestamp: new Date().toISOString() });
    service.recentCalls = service.recentCalls.slice(0, 50);
    service.updatedAt = new Date().toISOString();
    this.save();
  }
}

const serviceStore = new ServiceStore();
function serviceLogoPath(service) {
  if (!service?.logo?.storedName) return null;
  return path.join(LOGO_DIR, path.basename(service.logo.storedName));
}
module.exports = { serviceStore, publicService, slugify, serviceLogoPath };
