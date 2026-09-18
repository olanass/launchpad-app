const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../config/paths');

const UPLOADS_DIR = DATA_DIR;

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Master encryption secret for AES-256-GCM
function masterKey() {
  const secret = process.env.VAULT_MASTER_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set VAULT_MASTER_SECRET to at least 32 random characters');
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a buffer using AES-256-GCM
 * @param {Buffer} buffer
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }}
 */
function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/**
 * Decrypt a buffer using AES-256-GCM
 * @param {Buffer} ciphertext
 * @param {Buffer|string} iv
 * @param {Buffer|string} authTag
 * @returns {Buffer}
 */
function decryptBuffer(ciphertext, iv, authTag) {
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'hex');
  const tagBuf = Buffer.isBuffer(authTag) ? authTag : Buffer.from(authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), ivBuf);
  decipher.setAuthTag(tagBuf);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Process, encrypt with AES-256-GCM, and store an uploaded file
 * @param {Object} file - Express multer file object
 * @returns {Object} Stored asset metadata
 */
function storeUploadedFile(file) {
  if (!file) {
    throw new Error('No file provided');
  }

  const assetId = 'ast_' + crypto.randomBytes(8).toString('hex');
  const ext = path.extname(file.originalname).toLowerCase();
  const safeStorageName = `${assetId}.enc`;
  const targetPath = path.join(UPLOADS_DIR, safeStorageName);

  // Read plaintext buffer
  const rawBuffer = fs.readFileSync(file.path);
  try { fs.unlinkSync(file.path); } catch (e) {}

  // Compute cryptographic SHA-256 hash of plaintext
  const hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

  const preview = '[Protected content — payment required]';

  // Encrypt with AES-256-GCM before writing to disk
  const { ciphertext, iv, authTag } = encryptBuffer(rawBuffer);
  fs.writeFileSync(targetPath, ciphertext);

  return {
    assetId,
    originalName: file.originalname,
    storedFilename: safeStorageName,
    filePath: targetPath,
    fileSize: file.size,
    formattedSize: formatBytes(file.size),
    mimeType: file.mimetype || 'application/octet-stream',
    extension: ext,
    sha256: hash,
    preview,
    encrypted: true,
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    uploadedAt: new Date().toISOString()
  };
}

/**
 * Encrypt and store text / secret payload directly
 */
function storeTextAsset(title, content) {
  const assetId = 'ast_' + crypto.randomBytes(8).toString('hex');
  const safeStorageName = `${assetId}.enc`;
  const targetPath = path.join(UPLOADS_DIR, safeStorageName);

  const rawBuffer = Buffer.from(content, 'utf8');
  const hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
  const preview = '[Protected content — payment required]';

  // Encrypt with AES-256-GCM
  const { ciphertext, iv, authTag } = encryptBuffer(rawBuffer);
  fs.writeFileSync(targetPath, ciphertext);

  return {
    assetId,
    originalName: `${title || 'secret-document'}.txt`,
    storedFilename: safeStorageName,
    filePath: targetPath,
    fileSize: rawBuffer.length,
    formattedSize: formatBytes(rawBuffer.length),
    mimeType: 'text/plain',
    extension: '.txt',
    sha256: hash,
    preview,
    encrypted: true,
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    uploadedAt: new Date().toISOString()
  };
}

/**
 * Retrieve decrypted asset buffer
 * @param {Object} asset - Asset metadata object
 * @returns {Buffer}
 */
function getDecryptedAssetBuffer(asset) {
  const fullPath = getAssetPath(asset.storedFilename);
  if (!fullPath) {
    throw new Error('Underlying asset file not found on disk');
  }

  const diskData = fs.readFileSync(fullPath);

  // If asset was encrypted with AES-256-GCM, decrypt it
  if (asset.encrypted && asset.iv && asset.authTag) {
    return decryptBuffer(diskData, asset.iv, asset.authTag);
  }

  // Fallback for legacy / pre-existing unencrypted files
  return diskData;
}

/**
 * Stream decrypted asset to HTTP response
 * @param {Object} asset
 * @param {Object} res
 */
function streamDecryptedAsset(asset, res) {
  const decrypted = getDecryptedAssetBuffer(asset);
  res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.originalName)}"`);
  res.setHeader('Content-Length', decrypted.length);
  res.send(decrypted);
}

function getAssetPath(storedFilename) {
  if (typeof storedFilename !== 'string' || path.basename(storedFilename) !== storedFilename || /[\\/]/.test(storedFilename)) return null;
  const fullPath = path.join(UPLOADS_DIR, storedFilename);
  if (path.dirname(path.resolve(fullPath)) !== path.resolve(UPLOADS_DIR)) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const { pinBufferToIpfs, fetchBufferFromIpfs, isIpfsConfigured } = require('./ipfs');

/**
 * Pin an encrypted vault asset to real decentralized IPFS
 * @param {Object} asset
 * @returns {Promise<Object>}
 */
async function pinAssetToIpfs(asset) {
  if (!asset || !isIpfsConfigured()) return asset;
  try {
    const fullPath = getAssetPath(asset.storedFilename);
    if (!fullPath || !fs.existsSync(fullPath)) return asset;
    const diskData = fs.readFileSync(fullPath);
    const ipfsResult = await pinBufferToIpfs(diskData, asset.storedFilename, {
      assetId: asset.assetId,
      originalName: asset.originalName
    });
    if (ipfsResult) {
      asset.ipfsCid = ipfsResult.cid;
      asset.ipfsGatewayUrl = ipfsResult.gatewayUrl;
    }
  } catch (err) {
    console.warn('⚠️ [IPFS] Pinning failed, preserving local vault storage:', err.message);
  }
  return asset;
}

module.exports = {
  UPLOADS_DIR,
  storeUploadedFile,
  storeTextAsset,
  pinAssetToIpfs,
  getDecryptedAssetBuffer,
  streamDecryptedAsset,
  getAssetPath,
  formatBytes,
  encryptBuffer,
  decryptBuffer
};
