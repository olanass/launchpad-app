const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ethers } = require('ethers');
const { paywallService, publicPaywall } = require('./service');
const { storeUploadedFile, storeTextAsset, pinAssetToIpfs, getDecryptedAssetBuffer } = require('../vault/storage');
const { parseAmount } = require('../facilitator/amount');
const { checkChainReadiness } = require('../facilitator/verifier');
const { x402 } = require('../middleware/x402');
const router = express.Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'x402-uploads'), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10, fieldSize: 1024 * 1024 } });
router.get('/gas-estimate', async (req, res) => res.json({ success: true, estimate: await paywallService.getRealGasEstimate() }));
router.get('/chain-readiness', async (req, res) => {
  try {
    const status = await checkChainReadiness();
    res.json({ ready: true, ...status });
  } catch (_) {
    res.status(503).json({ ready: false, error: 'Payment verification is temporarily unavailable' });
  }
});
router.post('/create', upload.single('file'), async (req, res, next) => {
  let asset;
  let saved = false;
  try {
    const b = req.body || {};
    const { title, description = '', price, currency = 'USDC', creatorAddress, creatorSignature, creatorTimestamp } = b;
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof description !== 'string' || description.length > 4000) throw Object.assign(new Error('Valid title and description required'), { status: 400 });
    try {
      parseAmount(price, currency);
      if (!ethers.isAddress(creatorAddress)) throw new Error('Invalid creator address');
      if (!/^\d{13}$/.test(creatorTimestamp || '') || Math.abs(Date.now() - Number(creatorTimestamp)) > 300000) throw new Error('Creator signature expired');
      if ([...paywallService.paywalls.values()].some(p => p.creatorSignature === creatorSignature)) throw new Error('Creation signature already used');
    } catch (err) { err.status = 400; throw err; }
    if (req.file) asset = storeUploadedFile(req.file);
    else if (typeof b.textContent === 'string' && b.textContent.trim()) asset = storeTextAsset(title, b.textContent);
    else throw Object.assign(new Error('Upload a file or enter text content'), { status: 400 });
    const message = 'x402 create paywall\n' + JSON.stringify({ title, description, price, currency, creatorAddress: creatorAddress.toLowerCase(), contentHash: asset.sha256, timestamp: creatorTimestamp });
    try {
      if (ethers.verifyMessage(message, creatorSignature).toLowerCase() !== creatorAddress.toLowerCase()) throw new Error('Creator signature mismatch');
    } catch (_) { throw Object.assign(new Error('Valid creator signature required'), { status: 400 }); }
    asset = await pinAssetToIpfs(asset);
    const paywall = await paywallService.createPaywall({ title, description, price, currency, creatorAddress, creatorSignature, asset });
    saved = true;
    const base = process.env.PUBLIC_BASE_URL || req.protocol + '://' + req.get('host');
    res.status(201).json({ success: true, paywall: publicPaywall(paywall), shareableUrl: base.replace(/\/$/, '') + '/p/' + paywall.paywallId });
  } catch (err) { next(err); }
  finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (asset && !saved && fs.existsSync(asset.filePath)) fs.unlinkSync(asset.filePath);
  }
});
router.get('/creator/:address', (req, res) => {
  if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: 'Invalid wallet address' });
  const paywalls = paywallService.getPaywallsByCreator(req.params.address).map(publicPaywall);
  res.json({ success: true, creator: req.params.address, count: paywalls.length, paywalls });
});
router.get('/:id', (req, res) => {
  const paywall = paywallService.getPaywall(req.params.id);
  if (!paywall) return res.status(404).json({ error: 'Paywall not found' });
  paywall.viewsCount += 1;
  paywallService.savePaywalls();
  res.json({ success: true, paywall: { ...publicPaywall(paywall), gasEstimate: paywall.gasEstimate } });
});
router.get('/:id/download', async (req, res, next) => {
  try {
    const p = paywallService.getPaywall(req.params.id);
    if (!p) return res.status(404).json({ error: 'Paywall not found' });
    // Verify that delivery is possible before consuming a payment.
    const content = getDecryptedAssetBuffer(p.asset);
    return x402({ price: p.price, token: p.currency, recipient: p.creatorAddress })(req, res, () => {
      try {
        if (!req.x402.receipt.replayed) paywallService.recordSale(p.paywallId, p.price);
        res.set('Cache-Control', 'no-store');
        res.attachment(p.asset.originalName);
        res.type(p.asset.mimeType || 'application/octet-stream').send(content);
      } catch (err) { next(err); }
    });
  } catch (err) { next(err); }
});
module.exports = router;

