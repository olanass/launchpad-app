// -------------------------------------------------------------
// 7. PAYWALL CHECKOUT ROUTING & UNLOCK FLOW (/p/:id)
// -------------------------------------------------------------
function initPaywallViewRouting() {
  const path = window.location.pathname;
  if (path.includes('/p/')) {
    const paywallId = path.split('/p/')[1].split('/')[0].split('?')[0].trim();
    if (paywallId) {
      loadPaywallView(paywallId);
    }
  } else {
    switchView('create');
  }

  // Intercept internal /p/ links for seamless SPA navigation
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') && link.getAttribute('href').startsWith('/p/')) {
      e.preventDefault();
      const href = link.getAttribute('href');
      history.pushState(null, '', href);
      const paywallId = href.split('/p/')[1].split('/')[0].split('?')[0].trim();
      loadPaywallView(paywallId);
    }
  });

  window.addEventListener('popstate', () => {
    const p = window.location.pathname;
    if (p.includes('/p/')) {
      const pid = p.split('/p/')[1].split('/')[0].split('?')[0].trim();
      loadPaywallView(pid);
    } else {
      switchView('create');
    }
  });


  // Handle Accordion
  const btnToggleApi = document.getElementById('btnToggleAgentApi');
  const apiContent = document.getElementById('agentApiContent');
  if (btnToggleApi && apiContent) {
    btnToggleApi.addEventListener('click', () => {
      const isClosed = apiContent.style.display === 'none';
      apiContent.style.display = isClosed ? 'block' : 'none';
      btnToggleApi.querySelector('.accordion-arrow').textContent = isClosed ? '▲' : '▼';
    });
  }

  // Handle Unlock Button Click
  const btnUnlock = document.getElementById('btnUnlockPaywall');
  if (btnUnlock) {
    btnUnlock.addEventListener('click', handleUnlockPayment);
  }
}

async function loadPaywallView(paywallId) {
  if (state.paymentInProgress) { showAppNotice({ title: 'Payment in progress', message: 'Wait for the current payment before opening another paywall.' }); return; }
  state.paywallLoadId = paywallId;
  state.currentPaywall = null;
  if (state.downloadBlobUrl) { URL.revokeObjectURL(state.downloadBlobUrl); state.downloadBlobUrl = null; }
  document.getElementById('btnUnlockPaywall').style.display = '';
  document.getElementById('btnUnlockPaywall').disabled = false;
  document.getElementById('unlockedDownloadArea').style.display = 'none';
  document.getElementById('txStepper').style.display = 'none';
  switchView('paywall');

  try {
    const res = await fetch(`/api/paywalls/${paywallId}`);
    if (!res.ok) {
      throw new Error('Paywall not found or expired.');
    }

    const data = await res.json();
    if (state.paywallLoadId !== paywallId) return;
    state.currentPaywall = data.paywall;

    // Render Paywall Preview
    document.getElementById('paywallPriceBadge').textContent = `${data.paywall.price} ${data.paywall.currency}`;
    document.getElementById('paywallTitleDisplay').textContent = data.paywall.title;
    document.getElementById('paywallDescDisplay').textContent = data.paywall.description || `Verified x402 protected content on ${ROBINHOOD_CHAIN_NAME}.`;
    document.getElementById('paywallFilename').textContent = data.paywall.asset.originalName;
    document.getElementById('paywallFilesize').textContent = data.paywall.asset.formattedSize;
    document.getElementById('paywallPreviewBox').textContent = data.paywall.asset.preview || '[Protected Content]';
    document.getElementById('paywallCreatorAddr').textContent = `${data.paywall.creatorAddress.substring(0, 8)}...${data.paywall.creatorAddress.substring(data.paywall.creatorAddress.length - 6)}`;
    
    // IPFS Status Badge
    const ipfsBar = document.getElementById('ipfsStatusBar');
    const ipfsLink = document.getElementById('paywallIpfsLink');
    if (ipfsBar && ipfsLink) {
      if (data.paywall.asset && data.paywall.asset.ipfsCid) {
        ipfsBar.style.display = 'flex';
        ipfsLink.textContent = `CID: ${data.paywall.asset.ipfsCid.substring(0, 10)}... ↗`;
        ipfsLink.href = data.paywall.asset.ipfsGatewayUrl || `https://gateway.pinata.cloud/ipfs/${data.paywall.asset.ipfsCid}`;
      } else {
        ipfsBar.style.display = 'none';
      }
    }
    
    // cURL sample for AI agents
    const curlBox = document.getElementById('paywallCurlCode');
    if (curlBox) {
      curlBox.textContent = `# Autonomous AI Agent: Pay via HTTP 402 Micropayment on Robinhood Chain (ID: 4663)\ncurl -i -X GET "${window.location.origin}/api/paywalls/${data.paywall.paywallId}/download" \\\n  -H "PAYMENT-SIGNATURE: <signed_voucher>"`;
      curlBox.textContent = curlBox.textContent.replace(
        'Robinhood Chain (ID: 4663)',
        `${ROBINHOOD_CHAIN_NAME} (ID: ${ROBINHOOD_CHAIN_ID_DEC})`
      );
    }

    // Gas estimate
    if (data.paywall.gasEstimate) {
      document.getElementById('paywallGasNotice').textContent = `${data.paywall.gasEstimate.totalFeeEth ?? 'Unavailable'} ETH (${data.paywall.gasEstimate.formattedUsd})`;
    }

  } catch (err) {
    document.getElementById('paywallTitleDisplay').textContent = 'Error Loading Paywall';
    document.getElementById('paywallDescDisplay').textContent = err.message;
  }
}

async function handleUnlockPayment() {
  const paywall = state.currentPaywall;
  if (!paywall || state.paymentInProgress) return;

  // If no wallet connected, prompt login
  if (!state.currentWallet) {
    triggerPrivyLogin();
    return;
  }

  const btnUnlock = document.getElementById('btnUnlockPaywall');
  const unlockText = document.getElementById('unlockBtnText');
  const stepper = document.getElementById('txStepper');
  const stepWallet = document.getElementById('stepWallet');
  const stepL2 = document.getElementById('stepL2');
  const stepDecrypt = document.getElementById('stepDecrypt');

  btnUnlock.disabled = true;
  state.paymentInProgress = true;

  try {
    // ===== DIRECT METAMASK — using _metamask (captured before Privy hijack) =====
    const mm = state.currentWallet.isRealWeb3 ? (_metamask || window.ethereum) : await window.__privy?.getProvider();

    if (!mm) {
      throw new Error(`MetaMask not found. Please install MetaMask extension to pay on ${ROBINHOOD_CHAIN_NAME}.`);
    }

    stepper.style.display = 'flex';
    stepWallet.className = 'stepper-step active';
    stepL2.className = 'stepper-step';
    stepDecrypt.className = 'stepper-step';
    unlockText.textContent = '1/3: Confirm in MetaMask...';

    // 1. Get MetaMask accounts (triggers popup if locked)
    const accounts = await mm.request({ method: 'eth_requestAccounts' });
    const fromAddress = accounts[0];

    if (!fromAddress) {
      throw new Error('No account returned from MetaMask. Please unlock MetaMask and try again.');
    }

    if (!await ensureRobinhoodNetwork(mm)) throw new Error(`Switch to ${ROBINHOOD_CHAIN_NAME} before paying`);

    const networkScope = ROBINHOOD_NETWORK_KEY === 'mainnet' ? '' : `:${ROBINHOOD_NETWORK_KEY}`;
    const storageKey = 'x402_pending' + networkScope + ':' + paywall.paywallId + ':' + fromAddress.toLowerCase();
    let txHash = sessionStorage.getItem(storageKey);

    // Never initiate a new transfer unless the server can independently
    // verify it. Existing confirmed transfers may still be safely recovered.
    if (!txHash) {
      const readinessResponse = await fetch('/api/paywalls/chain-readiness', { cache: 'no-store' });
      const readiness = await readinessResponse.json().catch(() => ({}));
      if (!readinessResponse.ok || !readiness.ready) {
        throw new Error('Payment verification is temporarily unavailable; no payment was sent. Start the server with working Robinhood RPC access and retry.');
      }
    }

    // Check delivery and the current requirement before sending funds.
    const preflight = await fetch('/api/paywalls/' + paywall.paywallId + '/download');
    if (preflight.status !== 402) throw new Error('Content is unavailable; no payment was sent');
    const { challenge } = await preflight.json();
    if (!challenge || challenge.price !== String(paywall.price) || challenge.token !== paywall.currency || challenge.recipient.toLowerCase() !== paywall.creatorAddress.toLowerCase() || challenge.chainId !== ROBINHOOD_CHAIN_ID_DEC) throw new Error('Payment details changed; reload this paywall before paying');

    // 2. Calculate payment amount
    const supported = await fetch('/facilitator/supported').then(r => r.json());
    const token = supported.supportedTokens.find(t => t.symbol === paywall.currency);
    if (!token || supported.demoMode) throw new Error('Real checkout requires configured payment tokens and demo mode disabled');
    const units = decimalUnits(paywall.price, token.decimals);
    const recipient = paywall.creatorAddress;
    const tx = { from: fromAddress, to: recipient, value: '0x' + units.toString(16) };
    if (token.symbol !== 'ETH') {
      const code = await mm.request({ method: 'eth_getCode', params: [token.address, 'latest'] });
      if (!code || code === '0x' || /^0x0*$/.test(code)) throw new Error('The configured token contract is not deployed on this network; no payment was sent');
      const decimals = await mm.request({ method: 'eth_call', params: [{ to: token.address, data: '0x313ce567' }, 'latest'] });
      if (Number(BigInt(decimals)) !== token.decimals) throw new Error('Token decimals do not match the server configuration; no payment was sent');
      tx.to = token.address;
      tx.value = '0x0';
      tx.data = '0xa9059cbb' + recipient.slice(2).toLowerCase().padStart(64, '0') + units.toString(16).padStart(64, '0');
    }
    if (!txHash) {
      txHash = await mm.request({ method: 'eth_sendTransaction', params: [tx] });
      sessionStorage.setItem(storageKey, txHash);
    }

    const pendingExplorerLink = document.getElementById('linkExplorerTx');
    if (pendingExplorerLink) {
      pendingExplorerLink.href = `${ROBINHOOD_EXPLORER_URL}/tx/${txHash}`;
      pendingExplorerLink.textContent = 'View transaction on Blockscout ↗';
      pendingExplorerLink.style.display = 'block';
    }

    // Step 2: server-side chain verification
    stepWallet.className = 'stepper-step done';
    stepL2.className = 'stepper-step active';
    unlockText.textContent = `2/3: Verifying payment on ${ROBINHOOD_CHAIN_NAME}...`;

    const paymentVoucher = {
      scheme: 'onchain-tx',
      txHash,
      payer: fromAddress
    };

    const voucherHeader = btoa(JSON.stringify(paymentVoucher));

    // Request download with PAYMENT-SIGNATURE
    const downloadUrl = `/api/paywalls/${paywall.paywallId}/download`;
    const res = await fetchVerifiedDownload(downloadUrl, voucherHeader, status => { unlockText.textContent = status; });

    if (!res.ok) {
      throw new Error(`Download failed with status ${res.status}`);
    }

    // Step 3: the server verified the payment; decrypt and download.
    stepL2.className = 'stepper-step done';
    stepDecrypt.className = 'stepper-step active';
    unlockText.textContent = '3/3: Payment verified! Preparing download...';
    const blob = await res.blob();
    if (state.downloadBlobUrl) URL.revokeObjectURL(state.downloadBlobUrl);
    const blobUrl = window.URL.createObjectURL(blob);
    state.downloadBlobUrl = blobUrl;
    // Keep the confirmed transaction for safe retry after a dropped response.

    btnUnlock.style.display = 'none';
    const unlockedArea = document.getElementById('unlockedDownloadArea');
    const downloadBtn = document.getElementById('btnDownloadUnlockedFile');
    const explorerLink = document.getElementById('linkExplorerTx');

    downloadBtn.href = blobUrl;
    downloadBtn.download = paywall.asset.originalName;
    unlockedArea.style.display = 'block';

    if (txHash && explorerLink) {
      explorerLink.href = `${ROBINHOOD_EXPLORER_URL}/tx/${txHash}`;
      explorerLink.style.display = 'block';
    }

    // Auto-trigger download
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = paywall.asset.originalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (stepDecrypt) stepDecrypt.className = 'stepper-step done';

  } catch (err) {
    console.error('[x402] Payment error:', err);
    showAppNotice({
      title: 'Payment Error',
      message: err.message || `Transaction cancelled or failed on ${ROBINHOOD_CHAIN_NAME}.`,
      tip: `Make sure MetaMask is unlocked, on ${ROBINHOOD_CHAIN_NAME} (${ROBINHOOD_CHAIN_ID_DEC}), and has enough ETH.`,
      type: 'warning'
    });
    btnUnlock.disabled = false;
    unlockText.textContent = 'Pay & Unlock Content';
    if (stepper) stepper.style.display = 'none';
  } finally { state.paymentInProgress = false; }
}

async function fetchVerifiedDownload(url, voucherHeader, onProgress = () => {}) {
  const startedAt = Date.now();
  const deadline = startedAt + 90000;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': voucherHeader } });
    if (response.status !== 402) return response;

    const body = await response.json().catch(() => ({}));
    const details = body.details || body.message || `Payment rejected: Transaction not verified on ${ROBINHOOD_CHAIN_NAME}`;
    if (/CURVE\.n|invalid signature/i.test(details)) {
      throw new Error('The server is still running the previous payment code. Restart RUN-X402.cmd once, then retry; this payment will be reused.');
    }
    if (!/pending|not found|temporarily unavailable|RPC request failed/i.test(details)) throw new Error(details);

    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    onProgress(`2/3: Verifying payment on ${ROBINHOOD_CHAIN_NAME} (${elapsed}s)...`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`${ROBINHOOD_CHAIN_NAME} has not indexed the transaction yet. Retry to reuse the same payment.`);
}
