const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Run after build:assets: verify the actual files uploaded to the hosting layer.
const root = path.resolve(__dirname, '..');
test('docs build: Markdown index cannot shadow the /docs application route', () => {
  const publicDocs = path.join(root, 'public', 'docs');
  assert.ok(!fs.existsSync(path.join(publicDocs, 'index.md')), 'index.md shadows /docs on Vercel');
  const home = fs.readFileSync(path.join(publicDocs, 'home.md'), 'utf8');
  assert.match(home, /^# Welcome to Olanas/);
  const llms = fs.readFileSync(path.join(root, 'public', 'llms.txt'), 'utf8');
  assert.ok(llms.includes('Source: https://olanas.xyz/docs/home.md'));
  assert.ok(!llms.includes('Source: https://olanas.xyz/docs/index.md'));
  const roadmap = fs.readFileSync(path.join(publicDocs, 'ecosystem', 'roadmap.md'), 'utf8');
  assert.match(roadmap, /Phase 1: Agent payments/);
  assert.match(roadmap, /Phase 2: API marketplace/);
  assert.match(roadmap, /Phase 3: Multi-chain expansion/);
});
