const { spawnSync } = require('child_process');
const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=handshake:', 'test-regressions.js'], { cwd: __dirname, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
