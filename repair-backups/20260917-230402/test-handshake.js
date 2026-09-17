/**
 * Automated End-to-End Test for x402 on Robinhood Chain
 * Tests the complete HTTP 402 Handshake & Settlement lifecycle
 */

const http = require('http');
const app = require('./server');
const { AgentClient } = require('./packages/agent-client/client');

async function runTests() {
  console.log('⚡ Starting x402 End-to-End Protocol Validation...\n');

  // Start temporary test server on port 4029
  const TEST_PORT = 4029;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://localhost:${TEST_PORT}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Unauthenticated request must return HTTP 402
    // -------------------------------------------------------------
    console.log('1️⃣ Testing HTTP 402 Challenge Generation...');
    const rawRes = await fetch(`${baseUrl}/api/v1/market/robinhood-pulse`);
    assert(rawRes.status === 402, 'Unauthenticated request returns HTTP 402');
    
    const wwwAuth = rawRes.headers.get('www-authenticate');
    assert(wwwAuth && wwwAuth.includes('x402'), 'Header WWW-Authenticate contains "x402"');

    const paymentReqHeader = rawRes.headers.get('payment-required');
    assert(paymentReqHeader !== null, 'Header PAYMENT-REQUIRED is present');

    const challenge = JSON.parse(Buffer.from(paymentReqHeader, 'base64').toString('utf8'));
    assert(challenge.chainId === 4663, 'Challenge specifies Robinhood Chain (Chain ID: 4663)');
    assert(challenge.price === '0.002', 'Challenge specifies price: 0.002 USDC');
    assert(challenge.network === 'robinhood-chain', 'Challenge specifies network: robinhood-chain');

    // -------------------------------------------------------------
    // TEST 2: Autonomous Agent Client executes full handshake
    // -------------------------------------------------------------
    console.log('\n2️⃣ Testing Autonomous Agent 402 Handshake...');
    const agent = new AgentClient({ baseUrl });
    const handshakeResult = await agent.fetchWith402('/api/v1/market/robinhood-pulse');

    assert(handshakeResult.status === 200, 'Handshake succeeded with HTTP 200 OK');
    assert(handshakeResult.data && handshakeResult.data.success === true, 'Response contains valid data payload');
    assert(handshakeResult.receipt && handshakeResult.receipt.receiptId.startsWith('rcpt_rh_'), 'Receipt generated with "rcpt_rh_" prefix');
    assert(handshakeResult.receipt.chainId === 4663, 'Receipt records Robinhood Chain (4663)');
    assert(handshakeResult.handshakeSteps.length === 5, 'Full 5-phase handshake completed');

    // -------------------------------------------------------------
    // TEST 3: POST route with agent inference compute
    // -------------------------------------------------------------
    console.log('\n3️⃣ Testing POST /api/v1/agent/inference with payment...');
    const inferenceResult = await agent.fetchWith402('/api/v1/agent/inference', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Predict Arbitrum Orbit block settlement velocity' })
    });

    assert(inferenceResult.status === 200, 'POST inference returns HTTP 200');
    assert(inferenceResult.data.inferenceMetrics.tokensGenerated > 0, 'Inference engine executed compute');
    assert(inferenceResult.receipt.amount === '0.005', 'Paid exact price for compute ($0.005 USDC)');

    // -------------------------------------------------------------
    // TEST 4: Facilitator Analytics & Store Ledger
    // -------------------------------------------------------------
    console.log('\n4️⃣ Testing Facilitator Analytics & Ledger...');
    const analyticsRes = await fetch(`${baseUrl}/facilitator/analytics`);
    const analyticsData = await analyticsRes.json();

    assert(analyticsData.analytics.totalSettlements >= 2, 'Settlement counter updated in ledger');
    assert(analyticsData.analytics.totalVolumeUsd >= 0.007, 'Volume recorded accurately ($0.007+ USD)');
    assert(analyticsData.recentEvents.length >= 2, 'Live settlement events logged');

    // -------------------------------------------------------------
    // TEST 5: Receipt Query Endpoint
    // -------------------------------------------------------------
    console.log('\n5️⃣ Testing Receipt Query Endpoint...');
    const testReceiptId = handshakeResult.receipt.receiptId;
    const receiptQueryRes = await fetch(`${baseUrl}/facilitator/receipts/${testReceiptId}`);
    const receiptQueryData = await receiptQueryRes.json();

    assert(receiptQueryRes.status === 200, 'Receipt query returns HTTP 200');
    assert(receiptQueryData.receipt.receiptId === testReceiptId, 'Queried receipt matches expected ID');

    console.log(`\n🎉 Test Suite Completed: ${passed} Passed, ${failed} Failed\n`);
  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
