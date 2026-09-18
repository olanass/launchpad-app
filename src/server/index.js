const { loadEnv } = require('./config/load-env');

loadEnv();

const app = require('./app');
const { ROBINHOOD_CHAIN_CONFIG } = require('./config/chain');

const port = process.env.PORT || 4020;

app.listen(port, () => {
  console.log(`x402 Paywall is running at http://localhost:${port}`);
  console.log(`${ROBINHOOD_CHAIN_CONFIG.name} ID: ${ROBINHOOD_CHAIN_CONFIG.chainId}`);
  console.log(`Facilitator API: http://localhost:${port}/facilitator/supported`);
});
