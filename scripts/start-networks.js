const { spawn } = require('child_process');
const { loadEnv } = require('../src/server/config/load-env');

loadEnv();

const watch = process.argv.includes('--watch');
const processes = [];
for (const [network, fallbackPort] of [['mainnet', '4020'], ['testnet', '4021']]) {
  const port = process.env[`ROBINHOOD_${network.toUpperCase()}_PORT`] || fallbackPort;
  const args = [...(watch ? ['--watch'] : []), 'src/server/index.js'];
  const child = spawn(process.execPath, args, {
    cwd: require('path').resolve(__dirname, '..'),
    env: { ...process.env, ROBINHOOD_NETWORK: network, PORT: port },
    stdio: 'inherit',
    windowsHide: true
  });
  processes.push(child);
  child.on('exit', code => {
    if (code && code !== 0) {
      for (const sibling of processes) if (sibling !== child && !sibling.killed) sibling.kill();
      process.exitCode = code;
    }
  });
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (!child.killed) child.kill();
  setTimeout(() => process.exit(0), 100).unref();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
