'use strict';
// Isolated local visual preview. Never opens the production database or permits payment.
process.env.NODE_ENV = 'development';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.TURSO_AUTH_TOKEN = '';
process.env.X402_DEMO_MODE = 'false';
process.env.VAULT_MASTER_SECRET = 'local-preview-only-not-a-production-secret';
const next = require('next');
const { serviceStore } = require('../src/server/services/store');
const { createApp } = require('../src/server/app');
async function start() {
  const website = next({ dev: false, dir: process.cwd() });
  await website.prepare();
  for (const [name, category, description, price] of [
    ['Startup Pitch Scorer', 'AI & Analysis', 'Turn your startup pitch into an actionable assessment of clarity, market opportunity, and differentiation.', '0.002'],
    ['Web Research', 'Research', 'Get a concise research brief with sources for your next idea or decision.', '0.01'],
    ['Document Extractor', 'Developer Tools', 'Transform document text into structured data your agent can work with.', '0.005']
  ]) await serviceStore.create({ name, category, description: description + ' (Local preview fixture.)', price,
    currency: 'USDG', creatorAddress: '0x1111111111111111111111111111111111111111', payoutAddress: '0x2222222222222222222222222222222222222222',
    creatorSignature: 'preview-' + name, endpointUrl: 'https://example.invalid/preview', allowedMethods: ['POST'] });
  const express = require('express');
  const app = express();
  app.use((req, res, next) => {
    if (/\/api\/orders\/[^/]+\/(approve|payment|reconcile)$/.test(req.path)) return res.status(403).json({ error: 'Payments are disabled in this isolated local preview.' });
    next();
  });
  app.use(createApp({ serveClient: false }));
  app.use((req, res) => website.getRequestHandler()(req, res));
  app.listen(4035, '127.0.0.1', () => console.log('Isolated preview: http://127.0.0.1:4035 (payments disabled)'));
}
start().catch(error => { console.error(error); process.exitCode = 1; });
