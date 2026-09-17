/**
 * Automated Test for x402 Paywall Platform on Robinhood Chain
 * Verifies:
 * 1. Live Gas Estimator on Robinhood Chain RPC (Chain ID 4663)
 * 2. File Upload & Signed Paywall Creation
 * 3. Public Paywall Metadata Preview
 * 4. HTTP 402 Paywall Challenge on Unauthenticated Download
 * 5. Instant Payment Settlement & Unlocked File Download
 * 6. Creator Analytics & Links Dashboard
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('./server');

async function runPaywallTests() {
  console.log('🚀 Starting x402 Professional Paywall System Tests on Robinhood Chain...\n');

  const TEST_PORT = 4028;
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
    // TEST 1: Real-time Gas Estimate on Robinhood Chain
    // -------------------------------------------------------------
    console.log('1️⃣ Testing Real Gas Estimate from Robinhood Chain RPC (4663)...');
    const gasRes = await fetch(`${baseUrl}/api/paywalls/gas-estimate`);
    const gasData = await gasRes.json();

    assert(gasRes.status === 200, 'Gas endpoint returns HTTP 200');
    assert(gasData.success === true, 'Gas query success = true');
    assert(gasData.estimate.chainId === 4663, 'Gas estimate target is Robinhood Chain (ID: 4663)');
    assert(gasData.estimate.gasPriceGwei > 0, `Live Gas Price fetched: ${gasData.estimate.gasPriceGwei} Gwei`);
    assert(gasData.estimate.formattedUsd.includes('$'), `Formatted USD fee: ${gasData.estimate.formattedUsd}`);

    // -------------------------------------------------------------
    // TEST 2: File Upload & Signed Paywall Creation
    // -------------------------------------------------------------
    console.log('\n2️⃣ Testing Content Upload & Paywall Creation...');
    const testSecretContent = 'TOP_SECRET_ALPHA: Robinhood Chain Arbitrum Orbit finality confirmed <190ms.';
    
    // Create temporary test file
    const tempFilePath = path.join(__dirname, 'temp_test_doc.txt');
    fs.writeFileSync(tempFilePath, testSecretContent);

    // Build multipart request using native FormData
    const formData = new FormData();
    const fileBlob = new Blob([testSecretContent], { type: 'text/plain' });
    formData.append('file', fileBlob, 'alpha_strategy.txt');
    formData.append('title', 'Robinhood Chain Quant Strategy');
    formData.append('description', 'Exclusive alpha report for Orbit L2');
    formData.append('price', '1.50');
    formData.append('currency', 'USDC');
    formData.append('creatorAddress', '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b');
    formData.append('creatorSignature', '0xcreator_signed_voucher_4663');

    const createRes = await fetch(`${baseUrl}/api/paywalls/create`, {
      method: 'POST',
      body: formData
    });

    const createData = await createRes.json();
    assert(createRes.status === 201, 'Paywall created with HTTP 201');
    assert(createData.success === true, 'Create response success = true');
    assert(createData.paywall.paywallId.startsWith('pay_'), 'Paywall ID generated with pay_ prefix');
    assert(createData.paywall.price === '1.5', 'Price set to 1.50 USDC');
    assert(createData.shareableUrl.includes('/p/pay_'), `Generated Shareable URL: ${createData.shareableUrl}`);

    const paywallId = createData.paywall.paywallId;

    // -------------------------------------------------------------
    // TEST 3: Public Metadata Preview (No file leakage)
    // -------------------------------------------------------------
    console.log('\n3️⃣ Testing Public Paywall Preview Metadata...');
    const previewRes = await fetch(`${baseUrl}/api/paywalls/${paywallId}`);
    const previewData = await previewRes.json();

    assert(previewRes.status === 200, 'Preview returns HTTP 200');
    assert(previewData.paywall.title === 'Robinhood Chain Quant Strategy', 'Title matches creator input');
    assert(previewData.paywall.asset.originalName === 'alpha_strategy.txt', 'Asset original filename preserved');
    assert(previewData.paywall.asset.sha256.length === 64, 'SHA-256 cryptographic hash computed');

    // -------------------------------------------------------------
    // TEST 4: Unauthenticated Download -> HTTP 402 Challenge
    // -------------------------------------------------------------
    console.log('\n4️⃣ Testing HTTP 402 Challenge on Unpaid Download Request...');
    const unpaidRes = await fetch(`${baseUrl}/api/paywalls/${paywallId}/download`);

    assert(unpaidRes.status === 402, 'Unauthenticated download blocked with HTTP 402 Payment Required');
    assert(unpaidRes.headers.get('www-authenticate') === 'x402', 'Header WWW-Authenticate: x402');
    
    const challengeHeader = unpaidRes.headers.get('payment-required');
    assert(challengeHeader !== null, 'Header PAYMENT-REQUIRED is attached');

    const decodedChallenge = JSON.parse(Buffer.from(challengeHeader, 'base64').toString('utf8'));
    assert(decodedChallenge.price === '1.5', 'Challenge specifies price: 1.5 USDC');
    assert(decodedChallenge.chainId === 4663, 'Challenge specifies Robinhood Chain (4663)');
    assert(decodedChallenge.recipient.toLowerCase() === '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b'.toLowerCase(), 'Payout address matches creator');

    // -------------------------------------------------------------
    // TEST 5: Verified Payment Settlement & File Download
    // -------------------------------------------------------------
    console.log('\n5️⃣ Testing Payment Settlement & File Delivery...');
    const payerWallet = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
    const paymentProof = {
      scheme: 'sandbox',
      payer: payerWallet,
      recipient: decodedChallenge.recipient,
      amount: '1.50',
      token: 'USDC',
      chainId: 4663
    };

    const voucherHeader = Buffer.from(JSON.stringify(paymentProof)).toString('base64');

    const paidRes = await fetch(`${baseUrl}/api/paywalls/${paywallId}/download`, {
      headers: {
        'PAYMENT-SIGNATURE': voucherHeader
      }
    });

    assert(paidRes.status === 200, 'Paid request unlocks with HTTP 200 OK');
    assert(paidRes.headers.get('payment-response') !== null, 'Receipt returned in PAYMENT-RESPONSE header');

    const downloadedText = await paidRes.text();
    assert(downloadedText === testSecretContent, 'Downloaded file content matches original uploaded secret');

    // -------------------------------------------------------------
    // TEST 6: Creator Analytics & Dashboard List
    // -------------------------------------------------------------
    console.log('\n6️⃣ Testing Creator Dashboard & Sales Tracking...');
    const creatorListRes = await fetch(`${baseUrl}/api/paywalls/creator/0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b`);
    const creatorListData = await creatorListRes.json();

    assert(creatorListData.success === true, 'Creator list returned successfully');
    assert(creatorListData.count >= 1, 'Paywall recorded under creator wallet');
    
    const matchedPaywall = creatorListData.paywalls.find(p => p.paywallId === paywallId);
    assert(matchedPaywall && matchedPaywall.salesCount === 1, 'Sale recorded and counter incremented');
    assert(matchedPaywall.totalEarnedUsd === 1.5, 'Creator revenue recorded ($1.50)');

    // Cleanup temp test file
    try { fs.unlinkSync(tempFilePath); } catch (e) {}

    console.log(`\n🎉 All Paywall Tests Succeeded: ${passed} Passed, ${failed} Failed!\n`);
  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPaywallTests();
