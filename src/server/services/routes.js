const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const { parseAmount } = require('../facilitator/amount');
const { x402 } = require('../middleware/x402');
const { serviceStore, publicService, serviceLogoPath } = require('./store');
const { parseEndpointUrl, resolvePublicEndpoint, joinEndpoint, proxyRequest } = require('./endpoint-security');

const publicRouter = express.Router();
const gatewayRouter = express.Router();
const CREATION_PREFIX = 'x402 launch service\n';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESPONSE_HEADERS = new Set(['content-type', 'content-language', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'retry-after']);
const LOGO_LIMIT = 512 * 1024;

function validateLogo(body) {
  if (!body.logoDataUrl) {
    if (body.logoHash) throw Object.assign(new Error('Logo hash does not match an uploaded logo'), { status: 400 });
    return { logo: null, logoHash: '' };
  }
  if (typeof body.logoDataUrl !== 'string') throw Object.assign(new Error('Logo must be a data URL'), { status: 400 });
  const match = body.logoDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('Logo must be a PNG, JPEG, or WebP image'), { status: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > LOGO_LIMIT) throw Object.assign(new Error('Logo must be 512 KB or smaller'), { status: 400 });
  const mimeType = match[1];
  const validMagic = mimeType === 'image/png'
    ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!validMagic) throw Object.assign(new Error('Logo file content does not match its image type'), { status: 400 });
  const logoHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (body.logoHash !== logoHash) throw Object.assign(new Error('Logo hash mismatch'), { status: 400 });
  return { logo: { buffer, mimeType, hash: logoHash }, logoHash };
}

function baseUrl(req) { return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }

function creationPayload(input) {
  return {
    name: input.name, description: input.description, category: input.category, videoUrl: input.videoUrl || '', logoHash: input.logoHash || '',
    endpointUrl: input.endpointUrl, allowedMethods: input.allowedMethods,
    price: input.price, currency: input.currency,
    creatorAddress: input.creatorAddress.toLowerCase(), payoutAddress: input.payoutAddress.toLowerCase(),
    network: chain.networkId, chainId: chain.chainId, timestamp: input.creatorTimestamp
  };
}

function serviceCreationMessage(input) { return CREATION_PREFIX + JSON.stringify(creationPayload(input)); }

function validateCreation(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : 'Developer Tools';
  let videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
  if (videoUrl) {
    let parsedVideoUrl;
    try { parsedVideoUrl = new URL(videoUrl); } catch (_) { throw Object.assign(new Error('Video link must be a valid URL'), { status: 400 }); }
    if (!['http:', 'https:'].includes(parsedVideoUrl.protocol) || videoUrl.length > 1000) throw Object.assign(new Error('Video link must use HTTP or HTTPS'), { status: 400 });
    videoUrl = parsedVideoUrl.toString();
  }
  const endpointUrl = parseEndpointUrl(body.endpointUrl).toString();
  const allowedMethods = [...new Set((Array.isArray(body.allowedMethods) ? body.allowedMethods : ['POST']).map(value => String(value).toUpperCase()))].sort();
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : 'USDC';
  const creatorAddress = body.creatorAddress;
  const payoutAddress = body.payoutAddress || creatorAddress;
  const creatorTimestamp = body.creatorTimestamp;
  const { logo, logoHash } = validateLogo(body);
  if (!name || name.length > 120) throw Object.assign(new Error('Service name is required and must be at most 120 characters'), { status: 400 });
  if (description.length > 2000 || !category || category.length > 80) throw Object.assign(new Error('Description or category is too long'), { status: 400 });
  if (!allowedMethods.length || allowedMethods.some(method => !ALLOWED_METHODS.has(method))) throw Object.assign(new Error('Choose at least one supported HTTP method'), { status: 400 });
  if (body.network && body.network !== chain.networkId) throw Object.assign(new Error(`Network must be ${chain.networkId}`), { status: 400 });
  parseAmount(body.price, currency);
  if (!ethers.isAddress(creatorAddress) || !ethers.isAddress(payoutAddress)) throw Object.assign(new Error('Valid creator and payout addresses are required'), { status: 400 });
  if (!/^\d{13}$/.test(creatorTimestamp || '') || Math.abs(Date.now() - Number(creatorTimestamp)) > 300000) throw Object.assign(new Error('Creator signature expired'), { status: 400 });
  return { name, description, category, videoUrl, logo, logoHash, endpointUrl, allowedMethods, price: body.price, currency, creatorAddress, payoutAddress, creatorTimestamp, creatorSignature: body.creatorSignature };
}

publicRouter.get('/networks', (req, res) => res.json({
  success: true,
  networks: [{
    id: chain.networkId, name: chain.name, chainId: chain.chainId, caip2: chain.caip2,
    testnet: chain.testnet, explorerUrl: chain.explorerUrl,
    tokens: Object.values(chain.supportedTokens).map(token => ({ symbol: token.symbol, name: token.name, decimals: token.decimals, address: token.address }))
  }]
}));

publicRouter.post('/', async (req, res, next) => {
  try {
    const input = validateCreation(req.body || {});
    if (serviceStore.hasCreationSignature(input.creatorSignature)) throw Object.assign(new Error('Creation signature already used'), { status: 400 });
    let signer;
    try { signer = ethers.verifyMessage(serviceCreationMessage(input), input.creatorSignature); }
    catch (_) { throw Object.assign(new Error('Valid creator signature required'), { status: 400 }); }
    if (signer.toLowerCase() !== input.creatorAddress.toLowerCase()) throw Object.assign(new Error('Creator signature mismatch'), { status: 400 });
    await resolvePublicEndpoint(input.endpointUrl);
    const service = serviceStore.create(input);
    res.status(201).json({ success: true, service: publicService(service, baseUrl(req)) });
  } catch (error) { next(error); }
});

publicRouter.get('/', (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const result = serviceStore.list({ status: req.query.status, category: req.query.category, search: req.query.search, limit, offset });
    res.json({ success: true, total: result.total, limit, offset, services: result.services.map(service => publicService(service, baseUrl(req))) });
  } catch (error) { next(error); }
});

publicRouter.get('/creator/:address', (req, res) => {
  if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: 'Invalid wallet address' });
  const services = serviceStore.byCreator(req.params.address).map(service => publicService(service, baseUrl(req)));
  return res.json({ success: true, creator: req.params.address, count: services.length, services });
});

publicRouter.get('/:slug/logo', (req, res) => {
  const service = serviceStore.getBySlug(req.params.slug);
  const logoPath = serviceLogoPath(service);
  if (!service || !logoPath || !fs.existsSync(logoPath)) return res.status(404).json({ error: 'Service logo not found' });
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.type(service.logo.mimeType);
  return res.sendFile(logoPath);
});

publicRouter.get('/:slug', (req, res) => {
  const service = serviceStore.getBySlug(req.params.slug);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  return res.json({ success: true, service: publicService(service, baseUrl(req)) });
});

function readRequestBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(Object.assign(new Error('Request body is too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forwardedHeaders(req, body) {
  const headers = { accept: req.get('accept') || '*/*', 'user-agent': 'x402-launchpad/1.0' };
  if (req.get('content-type')) headers['content-type'] = req.get('content-type');
  if (body.length) headers['content-length'] = String(body.length);
  return headers;
}

gatewayRouter.use('/:slug', (req, res, next) => {
  const service = serviceStore.getBySlug(req.params.slug);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  if (service.status !== 'live') return res.status(503).json({ error: 'Service is not live' });
  if (!service.allowedMethods.includes(req.method)) return res.status(405).set('Allow', service.allowedMethods.join(', ')).json({ error: 'Method not allowed' });
  return x402({ price: service.price, token: service.currency, recipient: service.payoutAddress })(req, res, async () => {
    const startedAt = Date.now();
    const receipt = req.x402.receipt;
    try {
      if (receipt.replayed) return res.status(409).json({ error: 'Payment proof has already been used for this API request' });
      serviceStore.recordPayment(service.serviceId, receipt);
      const body = ['GET', 'HEAD'].includes(req.method) ? Buffer.alloc(0) : await readRequestBody(req);
      const suffix = req.path.replace(/^\/+/, '');
      const target = joinEndpoint(service.endpointUrl, suffix, new URL(req.originalUrl, 'http://gateway.invalid').search);
      const upstream = await proxyRequest(target, { method: req.method, headers: forwardedHeaders(req, body), body });
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (RESPONSE_HEADERS.has(name.toLowerCase()) && value != null) res.set(name, value);
      }
      res.set('X-X402-Service', service.slug);
      res.set('X-X402-Receipt', receipt.receiptId);
      const success = upstream.status >= 200 && upstream.status < 400;
      serviceStore.recordResult(service.serviceId, { receiptId: receipt.receiptId, status: upstream.status, latencyMs: Date.now() - startedAt, success });
      return res.status(upstream.status).send(upstream.body);
    } catch (error) {
      serviceStore.recordResult(service.serviceId, { receiptId: receipt.receiptId, status: error.status || 502, latencyMs: Date.now() - startedAt, success: false });
      return next(Object.assign(error, { status: error.status || 502 }));
    }
  });
});

module.exports = { publicRouter, gatewayRouter, serviceCreationMessage, creationPayload };
