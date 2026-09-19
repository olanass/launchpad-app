// Vercel's Express detector requires the recognized entrypoint to import
// Express directly, even though the configured app lives in src/server/app.
require('express');
const next = require('next');
const { loadEnv } = require('./src/server/config/load-env');

loadEnv();

const dev = process.env.NEXT_DEV === 'true' || String(process.env.npm_lifecycle_event || '').startsWith('dev');
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number(process.env.PORT || 4020);
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();
let server;
let shuttingDown = false;

async function start() {
  await nextApp.prepare();

  const { createApp } = require('./src/server/app');
  const app = createApp({ serveClient: false });
  app.use((req, res) => handle(req, res));

  server = app.listen(port, hostname, () => {
    console.log(`x402 Launchpad is running at http://localhost:${port}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
    await nextApp.close();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
