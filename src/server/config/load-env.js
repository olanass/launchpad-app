const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function loadEnv(filename = '.env') {
  const envPath = path.join(PROJECT_ROOT, filename);
  if (!fs.existsSync(envPath)) return;

  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [rawKey, ...rawValue] = trimmed.split('=');
    const key = rawKey.trim();
    if (process.env[key] !== undefined) continue;

    const value = rawValue.join('=').trim();
    process.env[key] = /^("|').*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}

module.exports = { loadEnv };
