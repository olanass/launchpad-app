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
