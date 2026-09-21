'use strict';
const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:4035';
async function main() {
  for (const [route, heading] of [['/', 'view-service-launch'], ['/payments', 'paymentRunner'], ['/services/startup-pitch-scorer', 'view-service-detail'], ['/orders/ord_' + 'a'.repeat(32), 'paymentRunner']]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.ok(html.includes(heading), 'Missing page heading: ' + route);
    assert.ok(html.includes('/styles/app.css'), 'Original stylesheet is missing');
    if (route === '/payments') {
      assert.ok(html.includes('id="agent-wallet-guide"'), 'Agent wallet guide is missing');
      assert.ok(html.includes('id="agentGuideClient"'), 'Client selector is missing');
      assert.ok(html.includes('Release preview:'), 'Release readiness warning is missing');
    }
    assert.ok(!html.includes('Give your agent'), 'Unwanted redesign is still rendered');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    const assets = [...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)].map(m => m[1].replaceAll('&amp;', '&'));
    assert.ok(assets.length > 0, 'No production assets: ' + route);
    for (const asset of new Set(assets)) assert.equal((await fetch(new URL(asset, base))).status, 200, asset);
    console.log('PASS', route, 'server render, security headers, and production assets');
  }
  const version = await (await fetch(base + '/api/version')).json();
  assert.equal(version.purchaseFlow, 'durable-orders-v1');
  const services = await (await fetch(base + '/api/services?status=live')).json();
  assert.ok(Array.isArray(services.services));
  const network = await (await fetch(base + '/api/orders/network')).json();
  assert.ok(Number.isInteger(network.chainId));
  const response = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const tools = (await response.json()).result.tools.map(tool => tool.name);
  for (const name of ['new_order_identity', 'create_order', 'get_order', 'reconcile_order']) assert.ok(tools.includes(name), 'Missing MCP tool: ' + name);
  console.log('PASS catalog, network, deployment version and MCP tool discovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
