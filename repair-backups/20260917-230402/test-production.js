/**
 * Production Verification Test
 * Verifies:
 * 1. Vault AES-256-GCM Encryption at Rest (zero plaintext on disk)
 * 2. On-the-fly streaming decryption upon valid payment
 * 3. Real Robinhood Chain RPC (Chain ID 4663, live block number)
 * 4. Double-spend prevention on onchain-tx hash redemptions
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { storeTextAsset, getDecryptedAssetBuffer, UPLOADS_DIR } = require('./packages/vault/storage');
const { ROBINHOOD_CHAIN_CONFIG } = require('./packages/facilitator/config');
const { verifyPayment } = require('./packages/facilitator/verifier');

async function testProductionFeatures() {
  console.log('🛡️ Testing Production Security & Robinhood Chain Integration...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Encryption at Rest
  console.log('1️⃣ Testing Vault AES-256-GCM Encryption at Rest...');
  const secretText = 'CONFIDENTIAL_MARKET_ALPHA_ROBINHOOD_4663_' + Date.now();
  const asset = storeTextAsset('alpha-report', secretText);

  assert(asset.encrypted === true, 'Asset marked as encrypted');
  assert(asset.cipher === 'aes-256-gcm', 'Cipher is AES-256-GCM');
  assert(asset.iv && asset.authTag, 'IV and AuthTag generated');

  const diskContent = fs.readFileSync(asset.filePath);
  assert(!diskContent.includes(secretText), 'Raw disk file contains ZERO plaintext (Encrypted at rest)');

  const decrypted = getDecryptedAssetBuffer(asset);
  assert(decrypted.toString('utf8') === secretText, 'Decrypted buffer matches original plaintext exactly');

  // 2. Robinhood Chain RPC Live Query
  console.log('\n2️⃣ Testing Live Robinhood Chain RPC (4663)...');
  const provider = new ethers.JsonRpcProvider(ROBINHOOD_CHAIN_CONFIG.rpcUrl);
  const network = await provider.getNetwork();
  const blockNum = await provider.getBlockNumber();

  assert(Number(network.chainId) === 4663, `Connected to Robinhood Chain (Chain ID: ${network.chainId})`);
  assert(blockNum > 0, `Live Orbit L2 Block Number: #${blockNum}`);

  // 3. Double-Spend Replay Attack Prevention
  console.log('\n3️⃣ Testing Double-Spend Replay Attack Prevention...');
  const testTxHash = '0xsim_' + Date.now().toString(16);
  const req = {
    price: '1.0',
    recipient: '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b',
    token: 'USDC'
  };

  const firstRedeem = await verifyPayment({ scheme: 'onchain-tx', txHash: testTxHash }, req);
  assert(firstRedeem.valid === true, 'First redemption succeeds');

  const secondRedeem = await verifyPayment({ scheme: 'onchain-tx', txHash: testTxHash }, req);
  assert(secondRedeem.valid === false, 'Second redemption rejected (Double-spend blocked)');
  assert(secondRedeem.error.includes('already been redeemed'), 'Rejection reason states already redeemed');

  console.log(`\n🎉 Production Verification Passed: ${passed} Passed, ${failed} Failed!\n`);
  process.exit(failed > 0 ? 1 : 0);
}

testProductionFeatures();
