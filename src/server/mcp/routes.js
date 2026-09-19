'use strict';

const express = require('express');
const { ethers } = require('ethers');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod/v4');
const { ROBINHOOD_CHAIN_CONFIG: chain } = require('../config/chain');
const { parseAmount } = require('../facilitator/amount');
const { serviceStore, publicService } = require('../services/store');
const { publicOpenApi, inputSchema } = require('../services/openapi');

const router = express.Router();
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];

function result(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

function safePath(path = '') {
  const value = String(path || '').trim();
  if (!value) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.includes('..')) throw new Error('path must be relative and cannot contain traversal');
  return '/' + value.replace(/^\/+/, '');
}

function paymentRequirement(service, origin) {
  const token = chain.supportedTokens[service.currency];
  return {
    x402Version: 2,
    resource: `${origin}/x402/${encodeURIComponent(service.slug)}`,
    accepts: [{
      scheme: 'onchain-tx', network: chain.caip2,
      amount: parseAmount(service.price, service.currency).toString(),
      asset: token.address || ethers.ZeroAddress, payTo: service.payoutAddress,
      maxTimeoutSeconds: 300, extra: { name: service.currency, version: '1', proof: 'confirmed-transaction' }
    }]
  };
}

function createMcpServer(origin, internalOrigin = origin) {
  const server = new McpServer({ name: 'olanas-api-launchpad', version: '1.0.0' });

  server.registerTool('search_apis', {
    description: 'Search live paid APIs listed on Olanas. Returns public gateway URLs only.',
    inputSchema: {
      query: z.string().max(120).optional(),
      category: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(50).optional()
    }
  }, async ({ query, category, limit = 20 }) => {
    const found = await serviceStore.list({ status: 'live', search: query, category, limit });
    return result({ total: found.total, services: found.services.map(service => publicService(service, origin)) });
  });

  server.registerTool('get_api_details', {
    description: 'Get public metadata, input schema, and optional gateway-rewritten OpenAPI document for a listed API.',
    inputSchema: { slug: z.string().min(1).max(80) }
  }, async ({ slug }) => {
    const service = await serviceStore.getBySlug(slug);
    if (!service || service.status !== 'live') return result({ error: 'Service not found' }, true);
    const details = publicService(service, origin);
    return result({ service: details, inputSchema: inputSchema(service), openapi: service.openapiDocument ? publicOpenApi(service, details.gatewayUrl) : null });
  });

  server.registerTool('get_payment_requirements', {
    description: 'Get canonical x402 payment requirements before deciding whether to spend. This tool never sends a payment.',
    inputSchema: { slug: z.string().min(1).max(80) }
  }, async ({ slug }) => {
    const service = await serviceStore.getBySlug(slug);
    if (!service || service.status !== 'live') return result({ error: 'Service not found' }, true);
    return result(paymentRequirement(service, origin));
  });

  server.registerTool('check_wallet_balance', {
    description: 'Read an address balance on Robinhood Chain. No private key or wallet connection is accepted.',
    inputSchema: {
      address: z.string().describe('Public EVM wallet address'),
      token: z.string().optional().describe('ETH or a supported token symbol')
    }
  }, async ({ address, token = 'ETH' }) => {
    if (!ethers.isAddress(address)) return result({ error: 'Invalid wallet address' }, true);
    const asset = chain.supportedTokens[String(token).toUpperCase()];
    if (!asset) return result({ error: 'Unsupported token' }, true);
    const request = new ethers.FetchRequest(chain.rpcUrl);
    request.timeout = 8000;
    const provider = new ethers.JsonRpcProvider(request, chain.chainId, { staticNetwork: true });
    try {
      const raw = asset.address
        ? await new ethers.Contract(asset.address, ERC20_BALANCE_ABI, provider).balanceOf(address)
        : await provider.getBalance(address);
      return result({ address: ethers.getAddress(address), token: asset.symbol, balance: ethers.formatUnits(raw, asset.decimals), chainId: chain.chainId });
    } finally { provider.destroy(); }
  });

  server.registerTool('call_paid_api', {
    description: 'Call a listed gateway. Without paymentSignature this safely returns the 402 challenge; payment signing stays in the agent wallet.',
    inputSchema: {
      slug: z.string().min(1).max(80),
      path: z.string().max(500).optional(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      body: z.unknown().optional(),
      paymentSignature: z.string().max(4096).optional().describe('Base64 x402 onchain-tx proof created outside this server')
    }
  }, async ({ slug, path, method = 'POST', body, paymentSignature }) => {
    const service = await serviceStore.getBySlug(slug);
    if (!service || service.status !== 'live') return result({ error: 'Service not found' }, true);
    if (!ALLOWED_METHODS.has(method) || !service.allowedMethods.includes(method)) return result({ error: 'Method is not enabled for this service' }, true);
    const headers = { accept: 'application/json' };
    let encodedBody;
    if (body != null && !['GET', 'HEAD'].includes(method)) {
      encodedBody = typeof body === 'string' ? body : JSON.stringify(body);
      headers['content-type'] = typeof body === 'string' ? 'text/plain' : 'application/json';
    }
    if (paymentSignature) headers['payment-signature'] = paymentSignature;
    const response = await fetch(`${internalOrigin}/x402/${encodeURIComponent(slug)}${safePath(path)}`, { method, headers, body: encodedBody });
    const text = (await response.text()).slice(0, 100000);
    let responseBody;
    try { responseBody = JSON.parse(text); } catch (_) { responseBody = text; }
    const decode = value => {
      if (!value) return null;
      try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); } catch (_) { return null; }
    };
    return result({
      status: response.status, body: responseBody,
      paymentRequired: decode(response.headers.get('payment-required')),
      paymentReceipt: decode(response.headers.get('payment-response')),
      receiptId: response.headers.get('x-x402-receipt')
    });
  });

  server.registerTool('get_payment_receipt', {
    description: 'Look up a durable x402 settlement receipt by its public receipt ID.',
    inputSchema: { receiptId: z.string().min(8).max(100) }
  }, async ({ receiptId }) => {
    const receipt = await serviceStore.getReceiptById(receiptId);
    return receipt ? result({ receipt }) : result({ error: 'Receipt not found' }, true);
  });

  return server;
}

router.post('/', async (req, res) => {
  const origin = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const internalOrigin = process.env.PUBLIC_BASE_URL
    ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
    : `http://127.0.0.1:${req.socket.localPort}`;
  const server = createMcpServer(origin, internalOrigin);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: req.body?.id ?? null });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

router.get('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'MCP uses stateless POST requests' }));
router.delete('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'MCP uses stateless POST requests' }));

module.exports = { router, createMcpServer, safePath };
