const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { paywallService } = require('./service');
const { storeUploadedFile, storeTextAsset, pinAssetToIpfs, getAssetPath, streamDecryptedAsset } = require('../vault/storage');
const { x402 } = require('../middleware/x402');

const router = express.Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'x402-uploads') });

/**
 * GET /api/paywalls/gas-estimate
 * Returns real-time gas fees from Robinhood Chain RPC
 */
router.get('/gas-estimate', async (req, res) => {
  try {
    const estimate = await paywallService.getRealGasEstimate();
    res.json({ success: true, estimate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paywalls/create
 * Uploads file/content and creates signed paywall link
 */
router.post('/create', upload.single('file'), async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      currency = 'USDC',
      creatorAddress,
      creatorSignature,
      textContent
    } = req.body;

    if (!price || parseFloat(price) <= 0) {
      return res.status(400).json({ error: 'Valid price is required' });
    }

    if (!creatorAddress) {
      return res.status(400).json({ error: 'Creator wallet address is required' });
    }

    let asset;
    if (req.file) {
      asset = storeUploadedFile(req.file);
    } else if (textContent && textContent.trim()) {
      asset = storeTextAsset(title || 'Secret Content', textContent);
    } else {
      return res.status(400).json({ error: 'Please upload a file or enter text content to monetize' });
    }

    // Pin encrypted asset to decentralized IPFS if configured
    asset = await pinAssetToIpfs(asset);

    const paywall = await paywallService.createPaywall({
      title: title || asset.originalName,
      description: description || '',
      price: String(price),
      currency,
      creatorAddress,
      creatorSignature,
      asset
    });

    const host = req.get('host') || 'localhost:4020';
    const protocol = req.protocol || 'http';
    const shareableUrl = `${protocol}://${host}/p/${paywall.paywallId}`;

    res.status(201).json({
      success: true,
      paywall,
      shareableUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/paywalls/:id
 * Public preview metadata for paywall page
 */
router.get('/:id', async (req, res) => {
  const paywall = paywallService.getPaywall(req.params.id);
  if (!paywall) {
    return res.status(404).json({ error: 'Paywall not found' });
  }

  // Refresh live gas estimate
  const currentGas = await paywallService.getRealGasEstimate();

  res.json({
    success: true,
    paywall: {
      paywallId: paywall.paywallId,
      title: paywall.title,
      description: paywall.description,
      price: paywall.price,
      currency: paywall.currency,
      creatorAddress: paywall.creatorAddress,
      creatorSignature: paywall.creatorSignature,
      asset: {
        originalName: paywall.asset.originalName,
        fileSize: paywall.asset.fileSize,
        formattedSize: paywall.asset.formattedSize,
        mimeType: paywall.asset.mimeType,
        extension: paywall.asset.extension,
        sha256: paywall.asset.sha256,
        preview: paywall.asset.preview,
        ipfsCid: paywall.asset.ipfsCid || null,
        ipfsGatewayUrl: paywall.asset.ipfsGatewayUrl || null
      },
      gasEstimate: currentGas,
      viewsCount: paywall.viewsCount,
      salesCount: paywall.salesCount,
      createdAt: paywall.createdAt
    }
  });
});

/**
 * GET /api/paywalls/:id/download
 * Gated download endpoint protected by x402 middleware
 */
router.get('/:id/download', async (req, res, next) => {
  const paywall = paywallService.getPaywall(req.params.id);
  if (!paywall) {
    return res.status(404).json({ error: 'Paywall not found' });
  }

  // Dynamic x402 middleware applied to this exact paywall
  const middleware = x402({
    price: paywall.price,
    token: paywall.currency,
    recipient: paywall.creatorAddress,
    scheme: 'exact'
  });

  middleware(req, res, () => {
    // If we reach this callback, payment is 100% verified and settled!
    paywallService.recordSale(paywall.paywallId, req.x402?.amount || paywall.price);

    try {
      // Stream decrypted asset bit-for-bit to authorized payer
      streamDecryptedAsset(paywall.asset, res);
    } catch (err) {
      res.status(500).json({ error: `Decryption or streaming failed: ${err.message}` });
    }
  });
});

/**
 * GET /api/paywalls/creator/:address
 * Returns paywalls created by a specific wallet
 */
router.get('/creator/:address', (req, res) => {
  const list = paywallService.getPaywallsByCreator(req.params.address);
  res.json({
    success: true,
    creator: req.params.address,
    count: list.length,
    paywalls: list
  });
});

module.exports = router;
