const assert = require('node:assert/strict');
async function verify() {
  const base = process.env.BASE_URL || 'http://localhost:4020';
  const id = process.argv[2];
  if (!/^pay_[a-f0-9]+$/.test(id || '')) throw new Error('Usage: node verify-link.js pay_<id>');
  for (const url of ['/p/' + id, '/style.css', '/app.js', '/api/paywalls/' + id]) {
    const response = await fetch(base + url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, url);
    console.log(url, response.status, response.headers.get('content-type'));
  }
}
verify().catch(err => { console.error(err.message); process.exitCode = 1; });

