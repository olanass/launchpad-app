const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:4020';
async function check(path, type) {
  const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path + ' must respond successfully without login redirects');
  assert.ok(response.headers.get('content-type')?.includes(type), path + ' returned the wrong content type');
  return response;
}
async function main() {
  const html = await (await check('/', 'text/html')).text();
  assert.ok(html.includes('launch-workspace-heading'), 'The domain is serving the old UI');
  assert.ok(!html.includes('service-preview-panel'), 'The removed sample preview is still present');
  const version = await (await check('/api/version', 'application/json')).json();
  assert.equal(version.repository, 'olanass/launchpad-app');
  if (process.env.EXPECTED_COMMIT) assert.equal(version.commit, process.env.EXPECTED_COMMIT);
  const networks = await (await check('/api/services/networks', 'application/json')).json();
  assert.ok(networks.networks.some(item => item.id.startsWith('robinhood-chain')));
  await check('/discovery/resources', 'application/json');
  await check('/llms.txt', 'text/plain');
  for (const route of ['/docs', '/docs/ecosystem/roadmap']) {
    const docs = await (await check(route, 'text/html')).text();
    assert.ok(docs.includes('id="docsArticle"'), route + ' must serve the documentation UI');
  }
  const markdownHome = await (await check('/docs/home.md', 'text/markdown')).text();
  assert.ok(markdownHome.startsWith('# Welcome to Olanas'), 'Markdown home must remain available separately');
  await check('/docs/developers/agents.md', 'text/markdown');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'deployment-verification', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
    assert.equal((await client.listTools()).tools.length, 6);
  } finally { await client.close(); }
  console.log('PASS: updated UI, deployment identity, Robinhood configuration, catalog, AI docs, and MCP tools', version);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
