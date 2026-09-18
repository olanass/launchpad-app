/**
 * x402 Paywall — Production Client Application
 * Platform: Robinhood Chain (Arbitrum Orbit L2, Chain ID: 4663)
 */

// CRITICAL: Capture the real MetaMask provider NOW, before Privy SDK
// can override window.ethereum with its own slow proxy.
const _metamask = window.ethereum;

// Official Robinhood Chain Parameters
const ROBINHOOD_CHAIN_ID_DEC = 4663;
const ROBINHOOD_CHAIN_ID_HEX = '0x1237'; // 4663 in hexadecimal
const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const ROBINHOOD_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

const ROBINHOOD_CHAIN_PARAMS = {
  chainId: ROBINHOOD_CHAIN_ID_HEX,
  chainName: 'Robinhood Chain',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: [ROBINHOOD_RPC_URL],
  blockExplorerUrls: [ROBINHOOD_EXPLORER_URL]
};

// Application State
const state = {
  currentWallet: null, // { address, balanceEth, balanceUsdc, type, isRealWeb3 }
  selectedFile: null,
  liveGasEstimate: null,
  currentPaywall: null,
  activeView: 'create',
  checkoutMode: 'web3', // 'web3' | 'sandbox'
  isOnRobinhood: true
};

document.addEventListener('DOMContentLoaded', () => {
  initAppNoticeModal();
  initNavigation();
  loadAvailableCurrencies();
  initPrivyWallet();
  initFileUpload();
  initGasPolling();
  initPaywallCreation();
  initPaywallViewRouting();
  initNetworkStatusListener();
  initDocsPortal();
  restoreSession();
});

// -------------------------------------------------------------
// 1. NAVIGATION & ROUTING
// -------------------------------------------------------------
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  const btnCreateNew = document.getElementById('btnCreateNew');
  if (btnCreateNew) {
    btnCreateNew.addEventListener('click', () => switchView('create'));
  }

  const navHome = document.getElementById('navHome');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/');
      switchView('create');
    });
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewName === 'mylinks') {
    fetchMyLinks();
  }
}

// -------------------------------------------------------------
// 2. ROBINHOOD CHAIN NETWORK VERIFICATION & SWITCHING
// -------------------------------------------------------------
async function ensureRobinhoodNetwork(prov = window.ethereum) {
  if (!prov) return false;

  try {
    const currentChainId = await prov.request({ method: 'eth_chainId' });
    if (currentChainId && (
      currentChainId.toLowerCase() === ROBINHOOD_CHAIN_ID_HEX.toLowerCase() ||
      parseInt(currentChainId, 16) === ROBINHOOD_CHAIN_ID_DEC
    )) {
      updateNetworkUI(true);
      return true;
    }

    // Attempt switch
    try {
      await prov.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ROBINHOOD_CHAIN_ID_HEX }]
      });
      const switched = await prov.request({ method: 'eth_chainId' });
      const verified = parseInt(switched, 16) === ROBINHOOD_CHAIN_ID_DEC;
      updateNetworkUI(verified);
      return verified;
    } catch (switchError) {
      if (switchError.code === 4902 || switchError.code === -32603) {
        await prov.request({
          method: 'wallet_addEthereumChain',
          params: [ROBINHOOD_CHAIN_PARAMS]
        });
        const added = await prov.request({ method: 'eth_chainId' });
        const verified = parseInt(added, 16) === ROBINHOOD_CHAIN_ID_DEC;
        updateNetworkUI(verified);
        return verified;
      }
      throw switchError;
    }
  } catch (err) {
    console.warn('Network switch rejected or unsupported:', err.message);
    updateNetworkUI(false);
    return false;
  }
}

function updateNetworkUI(isOnRobinhood) {
  state.isOnRobinhood = isOnRobinhood;
  const pill = document.getElementById('btnNetworkStatus');
  const text = document.getElementById('networkStatusText');
  if (!pill || !text) return;

  if (isOnRobinhood) {
    pill.classList.remove('warning');
    text.textContent = 'Robinhood (4663)';
    pill.title = 'Active on Robinhood Chain L2 (Arbitrum Orbit)';
  } else {
    pill.classList.add('warning');
    text.textContent = 'Switch to 4663';
    pill.title = 'Click to switch to Robinhood Chain (ID: 4663)';
  }
}

function initNetworkStatusListener() {
  const pill = document.getElementById('btnNetworkStatus');
  if (pill) {
    pill.addEventListener('click', async () => {
      await ensureRobinhoodNetwork();
    });
  }

  if (window.ethereum) {
    window.ethereum.on('chainChanged', (chainId) => {
      const isRH = chainId && chainId.toLowerCase() === ROBINHOOD_CHAIN_ID_HEX.toLowerCase();
      updateNetworkUI(isRH);
      if (state.currentWallet) {
        refreshBalances(state.currentWallet.address);
      }
    });

    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts && accounts[0]) {
        setConnectedWallet(accounts[0], 'Web3 Wallet');
      } else {
        state.currentWallet = null;
        localStorage.removeItem('x402_connected_wallet');
        updateWalletUI();
      }
    });

    // Initial chain check
    window.ethereum.request({ method: 'eth_chainId' })
      .then(id => updateNetworkUI(id && id.toLowerCase() === ROBINHOOD_CHAIN_ID_HEX.toLowerCase()))
      .catch(() => updateNetworkUI(true));
  }
}

async function fetchOnChainBalances(address) {
  try {
    const res = await fetch(ROBINHOOD_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_getBalance',
        params: [address, 'latest']
      })
    });
    const data = await res.json();
    if (data && data.result) {
      const wei = BigInt(data.result);
      const eth = (Number(wei) / 1e18).toFixed(4);
      return { ethBal: eth, usdcBal: 'Unavailable' };
    }
  } catch (err) {
    console.warn('Failed to query RPC balance:', err);
  }
  return { ethBal: 'Unavailable', usdcBal: 'Unavailable' };
}

async function refreshBalances(address) {
  const { ethBal, usdcBal } = await fetchOnChainBalances(address);
  if (state.currentWallet && state.currentWallet.address === address) {
    state.currentWallet.balanceEth = ethBal;
    state.currentWallet.balanceUsdc = usdcBal;
    localStorage.setItem('x402_connected_wallet', JSON.stringify(state.currentWallet));
    updateWalletUI();
  }
}

// -------------------------------------------------------------
// 3. OFFICIAL PRIVY AUTH CONNECTOR & WALLET INTEGRATION
// -------------------------------------------------------------

// Custom in-app modal popup replacing native browser alert()
function showAppNotice({ title = 'Notice', message = '', tip = '', type = 'error' } = {}) {
  const modal = document.getElementById('appNoticeModal');
  const titleEl = document.getElementById('appNoticeTitle');
  const msgEl = document.getElementById('appNoticeMsg');
  const tipEl = document.getElementById('appNoticeTip');
  const tipTextEl = document.getElementById('appNoticeTipText');
  const iconBox = document.getElementById('appNoticeIconBox');
  const iconSvg = document.getElementById('appNoticeIconSvg');

  if (!modal) {
    console.warn(`[${type}] ${title}: ${message}`);
    return;
  }

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  if (tip && tip.trim()) {
    if (tipTextEl) tipTextEl.textContent = tip;
    if (tipEl) {
      tipEl.style.display = 'flex';
      tipEl.className = type === 'warning' ? 'app-notice-tip warning-tip' : 'app-notice-tip';
    }
  } else {
    if (tipEl) tipEl.style.display = 'none';
  }

  if (iconBox) {
    iconBox.className = `app-notice-icon-box ${type}`;
  }

  if (iconSvg) {
    if (type === 'success') {
      iconSvg.innerHTML = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>';
    } else if (type === 'warning') {
      iconSvg.innerHTML = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>';
    } else {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';
    }
  }

  modal.style.display = 'flex';
}

function initAppNoticeModal() {
  const modal = document.getElementById('appNoticeModal');
  const btnClose = document.getElementById('btnCloseAppNotice');
  const btnDismiss = document.getElementById('btnDismissAppNotice');

  const hide = () => { if (modal) modal.style.display = 'none'; };

  if (btnClose) btnClose.addEventListener('click', hide);
  if (btnDismiss) btnDismiss.addEventListener('click', hide);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hide();
    });
  }
}

// Global trigger to launch the official Privy modal
async function triggerPrivyLogin() {
  try {
    if (!window.__privy?.ready && window.initPrivyBridge) await window.initPrivyBridge();
    if (window.__privy?.ready && typeof window.__privy.login === 'function') {
      window.__privy.login();
      return;
    }
    const provider = _metamask || window.ethereum;
    if (provider) {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (accounts?.[0] && await ensureRobinhoodNetwork(provider)) await setConnectedWallet(accounts[0], 'Web3 Wallet', true);
      return;
    }
    showAppNotice({ title: 'Wallet login unavailable', message: 'Wallet login is still loading or unavailable. Retry shortly, or use a browser with a wallet extension.', type: 'warning' });
  } catch (err) {
    showAppNotice({ title: 'Connection cancelled or unavailable', message: err.message, type: 'warning' });
  }
}

function initPrivyWallet() {
  const btnConnect = document.getElementById('btnConnectPrivy');
  const walletMenu = document.getElementById('walletMenu');

  btnConnect.addEventListener('click', () => {
    if (state.currentWallet) {
      walletMenu.classList.toggle('show');
    } else {
      triggerPrivyLogin();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.wallet-wrapper')) {
      walletMenu.classList.remove('show');
    }
  });

  // Listen for official Privy Auth events from the Privy bridge
  window.addEventListener('privy:authenticated', (e) => {
    const user = e.detail?.user;
    if (!user) return;

    let address = user.wallet?.address;
    if (!address && user.linkedAccounts) {
      const w = user.linkedAccounts.find(a => a.type === 'wallet');
      if (w) address = w.address;
    }


    if (address) {
      const emailAcc = user.linkedAccounts?.find(a => a.type === 'email');
      const emailStr = user.email?.address || emailAcc?.address;
      const label = emailStr ? `Privy (${emailStr})` : 'Privy Connected';
      setConnectedWallet(address, label, false);
    }
  });

  // Copy Address Handlers
  const triggerAddressCopy = () => {
    if (state.currentWallet) {
      navigator.clipboard.writeText(state.currentWallet.address);
      const copyMini = document.getElementById('btnCopyAddressMini');
      const copyMiniText = document.getElementById('copyMiniText');
      if (copyMini && copyMiniText) {
        copyMini.classList.add('copied');
        copyMiniText.textContent = 'Copied!';
        setTimeout(() => {
          copyMini.classList.remove('copied');
          copyMiniText.textContent = 'Copy';
        }, 2000);
      }
    }
  };

  const btnCopyMini = document.getElementById('btnCopyAddressMini');
  if (btnCopyMini) btnCopyMini.addEventListener('click', triggerAddressCopy);

  const dropdownAddrEl = document.getElementById('dropdownWalletAddr');
  if (dropdownAddrEl) {
    dropdownAddrEl.addEventListener('click', triggerAddressCopy);
    dropdownAddrEl.style.cursor = 'pointer';
  }

  const btnCopyFull = document.getElementById('btnCopyAddress');
  if (btnCopyFull) btnCopyFull.addEventListener('click', triggerAddressCopy);

  // Disconnect
  const btnDisconnect = document.getElementById('btnDisconnectWallet');
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      if (window.__privy && typeof window.__privy.logout === 'function') {
        window.__privy.logout();
      }
      state.currentWallet = null;
      localStorage.removeItem('x402_connected_wallet');
      updateWalletUI();
      walletMenu.classList.remove('show');
    });
  }
}

async function setConnectedWallet(address, type = 'Web3 Wallet', isRealWeb3 = true) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return;
  state.currentWallet = {
    address,
    type,
    balanceUsdc: 'Unavailable',
    balanceEth: 'Unavailable',
    isRealWeb3
  };
  localStorage.setItem('x402_connected_wallet', JSON.stringify(state.currentWallet));
  updateWalletUI();

  // Query live balance from Robinhood Chain RPC
  refreshBalances(address);
}

function restoreSession() {
  const saved = localStorage.getItem('x402_connected_wallet');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Discard legacy fake sandbox wallet
      if (parsed.address === '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b' || parsed.type === 'Web3 Sandbox') {
        localStorage.removeItem('x402_connected_wallet');
        state.currentWallet = null;
        updateWalletUI();
        return;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(parsed.address)) throw new Error('Invalid saved wallet');
      state.currentWallet = { ...parsed, balanceEth: 'Unavailable', balanceUsdc: 'Unavailable' };
      updateWalletUI();
      refreshBalances(state.currentWallet.address);
      return;
    } catch (e) {}
  }
}

function updateWalletUI() {
  const btn = document.getElementById('btnConnectPrivy');
  const btnText = document.getElementById('walletBtnText');
  const dropdownAddr = document.getElementById('dropdownWalletAddr');
  const balEl = document.getElementById('dropdownWalletBal');

  if (state.currentWallet) {
    const shortAddr = `${state.currentWallet.address.substring(0, 6)}...${state.currentWallet.address.substring(state.currentWallet.address.length - 4)}`;
    btnText.textContent = shortAddr;
    btn.classList.add('connected');
    dropdownAddr.textContent = state.currentWallet.address;

    if (balEl) {
      balEl.innerHTML = `
        <span class="bal-pill">${escapeHtml(state.currentWallet.balanceEth || '0.00')} ETH</span>
        <span class="bal-pill">${escapeHtml(state.currentWallet.balanceUsdc || '0.00')} USDC</span>
      `;
    }
  } else {
    btnText.textContent = 'Connect Wallet';
    btn.classList.remove('connected');
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// -------------------------------------------------------------
// 4. REAL-TIME GAS FEE POLLING (ROBINHOOD CHAIN RPC)
// -------------------------------------------------------------
async function initGasPolling() {
  fetchGasEstimate();
  setInterval(fetchGasEstimate, 7000);
}

async function fetchGasEstimate() {
  try {
    const res = await fetch('/api/paywalls/gas-estimate');
    const data = await res.json();
    if (data.success && data.estimate) {
      state.liveGasEstimate = data.estimate;
      renderGasEstimates(data.estimate);
    }
  } catch (err) {
    console.warn('Gas polling fallback:', err);
  }
}

function renderGasEstimates(est) {
  const liveGwei = document.getElementById('liveGasGwei');
  const liveUsd = document.getElementById('liveGasUsd');
  const cardGwei = document.getElementById('cardGasGwei');
  const cardCost = document.getElementById('cardGasEth');

  if (liveGwei) liveGwei.textContent = `${est.gasPriceGwei ?? 'Unavailable'} Gwei`;
  if (liveUsd) liveUsd.textContent = `(${est.formattedUsd})`;
  if (cardGwei) cardGwei.textContent = `${est.gasPriceGwei ?? 'Unavailable'} Gwei`;
  if (cardCost) cardCost.textContent = `${est.totalFeeEth ?? 'Unavailable'} ETH (${est.formattedUsd})`;
}

// -------------------------------------------------------------
// 5. FILE UPLOAD
// -------------------------------------------------------------

function initFileUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const filePreview = document.getElementById('filePreview');
  const btnRemove = document.getElementById('btnRemoveFile');

  dropZone.addEventListener('click', (e) => {
    if (e.target !== btnRemove && !btnRemove.contains(e.target)) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  btnRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    state.selectedFile = null;
    fileInput.value = '';
    document.getElementById('uploadPrompt').style.display = 'block';
    filePreview.style.display = 'none';
    const swarmPill = document.getElementById('p2pSwarmPill');
    if (swarmPill) swarmPill.style.display = 'none';
  });

  const toggleTextBtn = document.getElementById('btnToggleTextInput');
  const textWrapper = document.getElementById('textInputWrapper');
  if (toggleTextBtn && textWrapper) {
    toggleTextBtn.addEventListener('click', () => {
      textWrapper.style.display = textWrapper.style.display === 'none' ? 'block' : 'none';
    });
  }
}

function handleFileSelected(file) {
  state.selectedFile = file;
  document.getElementById('uploadPrompt').style.display = 'none';
  const filePreview = document.getElementById('filePreview');
  filePreview.style.display = 'flex';

  document.getElementById('previewFilename').textContent = file.name;
  document.getElementById('previewFilesize').textContent = formatBytes(file.size);

  const titleInput = document.getElementById('assetTitle');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, "");
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

  // Collapsible Advance Options Section Toggle
  const btnToggleAdvance = document.getElementById('btnToggleAdvance');
  const advanceDropdownBody = document.getElementById('advanceDropdownBody');
  if (btnToggleAdvance && advanceDropdownBody) {
    btnToggleAdvance.addEventListener('click', () => {
      const isClosed = advanceDropdownBody.style.display === 'none';
      advanceDropdownBody.style.display = isClosed ? 'block' : 'none';
      btnToggleAdvance.classList.toggle('open', isClosed);
    });
  }

  // Dynamic currency prefix and step
  const currSelect = document.getElementById('assetCurrency');
  const inputPrefix = document.querySelector('.input-prefix');
  const priceInput = document.getElementById('assetPrice');
  if (currSelect && inputPrefix) {
    currSelect.addEventListener('change', () => {
      if (currSelect.value === 'ETH') {
        inputPrefix.textContent = 'Ξ';
        if (priceInput && (priceInput.value === '2.50' || priceInput.value === '0.1')) {
          priceInput.value = '0.0005';
          priceInput.step = '0.0001';
        }
      } else {
        inputPrefix.textContent = '$';
        if (priceInput && priceInput.value === '0.0005') {
          priceInput.value = '2.50';
          priceInput.step = '0.10';
        }
      }
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
        btnPublish.innerHTML = 'Sign in your wallet (Robinhood Chain 4663)...';
        if (!await ensureRobinhoodNetwork(signingProvider)) throw new Error('Switch to Robinhood Chain to continue');

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
    document.getElementById('paywallDescDisplay').textContent = data.paywall.description || 'Verified x402 protected content on Robinhood Chain.';
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
      throw new Error('MetaMask not found. Please install MetaMask extension to pay on Robinhood Chain.');
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

    if (!await ensureRobinhoodNetwork(mm)) throw new Error('Switch to Robinhood Chain before paying');

    const storageKey = 'x402_pending:' + paywall.paywallId + ':' + fromAddress.toLowerCase();
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
    unlockText.textContent = '2/3: Verifying payment on Robinhood Chain...';

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
      message: err.message || 'Transaction cancelled or failed on Robinhood Chain.',
      tip: 'Make sure MetaMask is unlocked, on Robinhood Chain (4663), and has enough ETH.',
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
    const details = body.details || body.message || 'Payment rejected: Transaction not verified on Robinhood Chain';
    if (/CURVE\.n|invalid signature/i.test(details)) {
      throw new Error('The server is still running the previous payment code. Restart RUN-X402.cmd once, then retry; this payment will be reused.');
    }
    if (!/pending|not found|temporarily unavailable|RPC request failed/i.test(details)) throw new Error(details);

    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    onProgress(`2/3: Verifying payment on Robinhood Chain (${elapsed}s)...`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Robinhood Chain has not indexed the transaction yet. Retry to reuse the same payment.');
}

// -------------------------------------------------------------
// 8. MY PAYWALLED LINKS
// -------------------------------------------------------------
async function fetchMyLinks() {
  const tbody = document.getElementById('myLinksTableBody');
  if (!state.currentWallet) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted" style="padding: 32px;">
          Please connect your wallet to view your paywalled links.
        </td>
      </tr>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/paywalls/creator/${state.currentWallet.address}`);
    const data = await res.json();

    if (!data.paywalls || data.paywalls.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted" style="padding: 32px;">
            No paywalls created yet with this wallet. Click "Create Paywall" to launch your first one!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.paywalls.map(p => {
      const shareUrl = `${window.location.origin}/p/${encodeURIComponent(p.paywallId)}`;
      const dateStr = new Date(p.createdAt).toLocaleDateString();

      return `
        <tr>
          <td>
            <strong>${escapeHtml(p.title)}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(p.asset.originalName)} (${escapeHtml(p.asset.formattedSize)})</div>
          </td>
          <td><strong>${escapeHtml(p.price)} ${escapeHtml(p.currency)}</strong></td>
          <td>${p.viewsCount || 0}</td>
          <td>${p.salesCount || 0}</td>
          <td class="text-success"><strong>${escapeHtml(p.totalEarned || 0)} ${escapeHtml(p.currency)}</strong></td>
          <td>${dateStr}</td>
          <td>
            <a href="${shareUrl}" target="_blank" class="btn btn-secondary btn-sm">View ↗</a>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-danger" style="padding: 24px;">
          Failed to load links: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

// -------------------------------------------------------------
// 9. DOCUMENTATION PORTAL LOGIC
// -------------------------------------------------------------
function initDocsPortal() {
  // 1. Tabbed Navigation
  const tabBtns = document.querySelectorAll('.doc-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.docTab;
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.doc-tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(`pane-${tabName}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // 2. Code Language Switcher
  const langTabs = document.querySelectorAll('.code-lang-tab');
  langTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const lang = tab.dataset.lang;
      langTabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.code-snippet-wrapper').forEach(w => w.style.display = 'none');

      tab.classList.add('active');
      const targetCode = document.getElementById(`code-${lang}`);
      if (targetCode) targetCode.style.display = 'block';
    });
  });

  // 3. Copy Code Buttons
  const copyBtns = document.querySelectorAll('.btn-copy-code');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const el = document.getElementById(targetId);
      if (el) {
        navigator.clipboard.writeText(el.innerText || el.textContent);
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied');
        }, 2000);
      }
    });
  });

  // 4. FAQ Accordion
  const faqQuestions = document.querySelectorAll('.faq-question');
  faqQuestions.forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      if (item) item.classList.toggle('open');
    });
  });
}


function escapeHtml(value) {
  const el = document.createElement('span'); el.textContent = String(value ?? ''); return el.innerHTML;
}
function decimalUnits(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid price');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Price has too many decimal places');
  const units = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (units <= 0n || units >= 2n ** 256n) throw new Error('Invalid price');
  return units;
}
async function loadAvailableCurrencies() {
  try {
    const config = await fetch('/facilitator/supported').then(r => r.json());
    const select = document.getElementById('assetCurrency');
    select.replaceChildren(...config.supportedTokens.map(t => new Option(t.symbol, t.symbol)));
  } catch (_) { document.getElementById('btnPublishPaywall').disabled = true; }
}
