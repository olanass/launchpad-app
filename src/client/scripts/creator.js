// -------------------------------------------------------------
// 5. FILE UPLOAD
// -------------------------------------------------------------

function initFileUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const filePreview = document.getElementById('uploadedFileCard');
  const btnRemove = document.getElementById('btnRemoveFile');

  if (!dropZone || !fileInput || !filePreview || !btnRemove) return;

  dropZone.addEventListener('click', (event) => {
    if (event.target !== btnRemove && !btnRemove.contains(event.target)) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-active');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
  });

  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-active');
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      handleFileSelected(event.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (event) => {
    if (event.target.files && event.target.files[0]) {
      handleFileSelected(event.target.files[0]);
    }
  });

  btnRemove.addEventListener('click', (event) => {
    event.stopPropagation();
    state.selectedFile = null;
    fileInput.value = '';
    document.getElementById('uploadPrompt').style.display = 'block';
    filePreview.style.display = 'none';
  });

  const toggleTextBtn = document.getElementById('btnToggleTextInput');
  const textWrapper = document.getElementById('textInputWrapper');
  if (toggleTextBtn && textWrapper) {
    toggleTextBtn.addEventListener('click', () => {
      const opening = textWrapper.style.display === 'none';
      textWrapper.style.display = opening ? 'block' : 'none';
      if (opening) document.getElementById('textContentInput')?.focus();
    });
  }
}

function handleFileSelected(file) {
  state.selectedFile = file;
  document.getElementById('uploadPrompt').style.display = 'none';

  const filePreview = document.getElementById('uploadedFileCard');
  filePreview.style.display = 'flex';

  document.getElementById('fileNameDisplay').textContent = file.name;
  document.getElementById('fileMetaDisplay').textContent = `${formatBytes(file.size)} · Ready to encrypt`;

  const extension = file.name.includes('.') ? file.name.split('.').pop().slice(0, 4).toUpperCase() : 'FILE';
  document.getElementById('fileTypeIcon').textContent = extension;

  const titleInput = document.getElementById('assetTitle');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, '');
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// -------------------------------------------------------------
// 6. PAYWALL CREATION & CRYPTOGRAPHIC SIGNING
// -------------------------------------------------------------
function initPaywallCreation() {
  const btnPublish = document.getElementById('btnPublishPaywall');
  const btnCopy = document.getElementById('btnCopyUrl');

  btnPublish.addEventListener('click', handlePublishPaywall);

  btnCopy.addEventListener('click', () => {
    const input = document.getElementById('generatedUrlInput');
    input.select();
    navigator.clipboard.writeText(input.value);
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = 'Copy'; }, 2000);
  });

  const btnToggleAdvance = document.getElementById('btnToggleAdvance');
  const advanceDropdownBody = document.getElementById('advanceDropdownBody');
  if (btnToggleAdvance && advanceDropdownBody) {
    btnToggleAdvance.addEventListener('click', () => {
      const isClosed = advanceDropdownBody.style.display === 'none';
      advanceDropdownBody.style.display = isClosed ? 'block' : 'none';
      btnToggleAdvance.classList.toggle('open', isClosed);
    });
  }

  const currSelect = document.getElementById('assetCurrency');
  const inputPrefix = document.querySelector('.input-prefix');
  if (currSelect) {
    currSelect.addEventListener('change', () => {
      if (inputPrefix) inputPrefix.textContent = currSelect.value === 'ETH' ? 'Ξ' : '$';
    });
  }
}

async function handlePublishPaywall() {
  if (!state.currentWallet) {
    triggerPrivyLogin();
    return;
  }

  const title = document.getElementById('assetTitle').value.trim();
  const desc = document.getElementById('assetDesc').value.trim();
  const price = document.getElementById('assetPrice').value.trim();
  const currency = document.getElementById('assetCurrency').value;
  const textContent = document.getElementById('textContentInput').value.trim();

  if (!state.selectedFile && !textContent) {
    showAppNotice({
      title: 'Content Required',
      message: 'Please upload a file or enter text content to monetize before generating your paywall.',
      type: 'warning'
    });
    return;
  }

  if (!/^\d+(\.\d+)?$/.test(price) || Number(price) <= 0) {
    showAppNotice({
      title: 'Valid Price Required',
      message: 'Please enter a valid price (e.g. 1.50 USDC or 0.005 ETH) greater than 0.',
      type: 'warning'
    });
    return;
  }

  const btnPublish = document.getElementById('btnPublishPaywall');
  btnPublish.disabled = true;
  btnPublish.innerHTML = 'Signing with Wallet...';

  try {
    const creatorAddress = state.currentWallet.address;
    let creatorSignature;
    const creatorTimestamp = String(Date.now());
    const actualTitle = title || 'Monetized Digital Asset';

    // Resolve the correct provider based on how the wallet was connected
    let signingProvider = null;
    if (state.currentWallet.isRealWeb3 && window.ethereum) {
      signingProvider = window.ethereum;
    } else if (window.__privy && typeof window.__privy.getProvider === 'function') {
      try {
        signingProvider = await window.__privy.getProvider();
      } catch (e) {
        console.warn('[x402] Privy getProvider failed for signing:', e);
      }
    } else if (window.ethereum) {
      signingProvider = window.ethereum;
    }

    // Wallet Signing Prompt
    if (!signingProvider) throw new Error('Connect a wallet to sign this paywall');
    if (signingProvider) {
      try {
      btnPublish.innerHTML = `Sign in your wallet (${ROBINHOOD_CHAIN_NAME} ${ROBINHOOD_CHAIN_ID_DEC})...`;
      if (!await ensureRobinhoodNetwork(signingProvider)) throw new Error(`Switch to ${ROBINHOOD_CHAIN_NAME} to continue`);

        // Request accounts to trigger popup
        await signingProvider.request({ method: 'eth_requestAccounts' });

        const content = state.selectedFile ? await state.selectedFile.arrayBuffer() : new TextEncoder().encode(textContent);
        const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content))).map(b => b.toString(16).padStart(2, '0')).join('');
        const signMsg = 'x402 create paywall\n' + JSON.stringify({ title: actualTitle, description: desc, price, currency, creatorAddress: creatorAddress.toLowerCase(), contentHash, timestamp: creatorTimestamp });
        creatorSignature = await signingProvider.request({
          method: 'personal_sign',
          params: [signMsg, creatorAddress]
        });
      } catch (signErr) {
        throw signErr;
      }
    }

    // Prepare FormData payload
    const formData = new FormData();
    formData.append('title', actualTitle);
    formData.append('creatorTimestamp', creatorTimestamp);
    formData.append('description', desc);
    formData.append('price', price);
    formData.append('currency', currency);
    formData.append('creatorAddress', creatorAddress);
    formData.append('creatorSignature', creatorSignature);

    if (state.selectedFile) {
      formData.append('file', state.selectedFile);
    } else if (textContent) {
      formData.append('textContent', textContent);
    }

    // Post to server
    btnPublish.innerHTML = 'Encrypting & Storing in Vault...';
    const res = await fetch('/api/paywalls/create', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to create paywall');
    }

    // Display Success Result Card
    const successCard = document.getElementById('successCard');
    const urlInput = document.getElementById('generatedUrlInput');
    const previewLink = document.getElementById('linkOpenPreview');
    const successPrice = document.getElementById('successPrice');

    urlInput.value = data.shareableUrl;
    previewLink.href = `/p/${data.paywall.paywallId}`;
    successPrice.textContent = `${data.paywall.price} ${data.paywall.currency}`;

    const rowSuccessIpfs = document.getElementById('rowSuccessIpfs');
    const successIpfsLink = document.getElementById('successIpfsLink');
    if (rowSuccessIpfs && successIpfsLink) {
      if (data.paywall.asset && data.paywall.asset.ipfsCid) {
        rowSuccessIpfs.style.display = 'flex';
        successIpfsLink.textContent = data.paywall.asset.ipfsCid;
        successIpfsLink.href = data.paywall.asset.ipfsGatewayUrl || `https://gateway.pinata.cloud/ipfs/${data.paywall.asset.ipfsCid}`;
      } else {
        rowSuccessIpfs.style.display = 'none';
      }
    }

    successCard.style.display = 'block';
    successCard.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    showAppNotice({
      title: 'Paywall Creation Error',
      message: err.message,
      type: 'error'
    });
  } finally {
    btnPublish.disabled = false;
    btnPublish.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      Sign with Wallet & Generate URL
    `;
  }
}
