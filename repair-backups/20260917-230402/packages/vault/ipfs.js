/**
 * Real Decentralized IPFS Storage Service via Pinata
 * x402 Protocol for Robinhood Chain (Arbitrum Orbit L2, Chain ID: 4663)
 */

function getPinataJwt() {
  return process.env.PINATA_JWT || '';
}

function getPinataGateway() {
  return process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
}

const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs/';

function isIpfsConfigured() {
  const jwt = getPinataJwt();
  return !!jwt && jwt.length > 20;
}

/**
 * Pin an encrypted buffer directly to real IPFS
 * @param {Buffer} buffer - The encrypted ciphertext buffer
 * @param {string} filename - Filename for IPFS metadata
 * @param {Object} [meta] - Additional key-value metadata
 * @returns {Promise<{ cid: string, gatewayUrl: string, pinSize: number } | null>}
 */
async function pinBufferToIpfs(buffer, filename = 'encrypted_payload.enc', meta = {}) {
  if (!isIpfsConfigured()) {
    console.log('ℹ️ [IPFS] Pinata credentials not configured. Using local vault storage.');
    return null;
  }

  try {
    const form = new FormData();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    form.append('file', blob, filename);

    const pinataMetadata = JSON.stringify({
      name: filename,
      keyvalues: {
        protocol: 'x402',
        network: 'robinhood-chain-4663',
        cipher: 'aes-256-gcm',
        ...meta
      }
    });
    form.append('pinataMetadata', pinataMetadata);

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getPinataJwt()}`
      },
      body: form
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️ [IPFS] Pinata upload returned HTTP ${res.status}:`, errText);
      return null;
    }

    const data = await res.json();
    const cid = data.IpfsHash;
    const gatewayUrl = `${getPinataGateway().replace(/\/$/, '')}/${cid}`;

    console.log(`🌐 [IPFS] Successfully pinned to IPFS! CID: ${cid} (${data.PinSize} bytes)`);

    return {
      cid,
      gatewayUrl,
      pinSize: data.PinSize,
      timestamp: data.Timestamp
    };
  } catch (err) {
    console.warn('⚠️ [IPFS] Pinning to IPFS failed, falling back to local encrypted vault:', err.message);
    return null;
  }
}

/**
 * Fetch ciphertext buffer from IPFS
 * @param {string} cid - IPFS Content Identifier
 * @returns {Promise<Buffer|null>}
 */
async function fetchBufferFromIpfs(cid) {
  if (!cid) return null;

  try {
    const pinataUrl = `${getPinataGateway().replace(/\/$/, '')}/${cid}`;
    const res = await fetch(pinataUrl, {
      headers: {
        'x-pinata-gateway-token': getPinataJwt()
      },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
  } catch (e) {
    // Fallback to public gateway
  }

  try {
    const publicUrl = `${PUBLIC_GATEWAY}${cid}`;
    const res = await fetch(publicUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
  } catch (e) {}

  return null;
}

module.exports = {
  isIpfsConfigured,
  pinBufferToIpfs,
  fetchBufferFromIpfs,
  getPinataGateway
};
