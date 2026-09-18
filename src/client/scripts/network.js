// -------------------------------------------------------------
// 2. ROBINHOOD CHAIN NETWORK VERIFICATION & SWITCHING
// -------------------------------------------------------------
function chainParamsFor(network) {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [network.rpcUrl],
    blockExplorerUrls: [network.explorerUrl]
  };
}

async function switchProviderNetwork(prov, network) {
  const params = chainParamsFor(network);
  try {
    await prov.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
  } catch (error) {
    if (error.code !== 4902 && error.code !== -32603) throw error;
    await prov.request({ method: 'wallet_addEthereumChain', params: [params] });
  }
  const chainId = await prov.request({ method: 'eth_chainId' });
  return chainId && parseInt(chainId, 16) === network.chainId;
}

function initNetworkSelector() {
  const select = document.getElementById('networkSelector');
  if (!select) return;
  const networks = ROBINHOOD_NETWORKS.length ? ROBINHOOD_NETWORKS : [{ networkKey: ROBINHOOD_NETWORK_KEY, name: ROBINHOOD_CHAIN_NAME, chainId: ROBINHOOD_CHAIN_ID_DEC }];
  select.replaceChildren(...networks.map(network => new Option(
    `${network.testnet ? 'Testnet' : 'Mainnet'} (${network.chainId})`,
    network.networkKey
  )));
  select.value = ROBINHOOD_NETWORK_KEY;
  select.addEventListener('change', async () => {
    const target = networks.find(network => network.networkKey === select.value);
    if (!target || target.networkKey === ROBINHOOD_NETWORK_KEY) return;
    select.disabled = true;
    try {
      if (!target.appUrl) throw new Error(`The ${target.name} app URL is not configured on this deployment.`);
      const provider = _metamask || (state.currentWallet?.isRealWeb3 ? window.ethereum : null);
      if (provider && !await switchProviderNetwork(provider, target)) throw new Error(`Your wallet did not switch to ${target.name}.`);
      const destination = new URL(target.appUrl, window.location.origin);
      destination.search = '';
      destination.hash = '';
      window.location.assign(destination.toString());
    } catch (error) {
      select.value = ROBINHOOD_NETWORK_KEY;
      select.disabled = false;
      showAppNotice({ title: 'Network Switch Failed', message: error.message, type: 'warning' });
    }
  });
}

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

    const verified = await switchProviderNetwork(prov, {
      chainId: ROBINHOOD_CHAIN_ID_DEC,
      name: ROBINHOOD_CHAIN_NAME,
      nativeCurrency: ROBINHOOD_CHAIN_PARAMS.nativeCurrency,
      rpcUrl: ROBINHOOD_RPC_URL,
      explorerUrl: ROBINHOOD_EXPLORER_URL
    });
    updateNetworkUI(verified);
    return verified;
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
    text.textContent = ROBINHOOD_NETWORK_KEY === 'testnet' ? `Testnet (${ROBINHOOD_CHAIN_ID_DEC})` : `Robinhood (${ROBINHOOD_CHAIN_ID_DEC})`;
    pill.title = `Active on ${ROBINHOOD_CHAIN_NAME}`;
  } else {
    pill.classList.add('warning');
    text.textContent = `Switch to ${ROBINHOOD_CHAIN_ID_DEC}`;
    pill.title = `Click to switch to ${ROBINHOOD_CHAIN_NAME} (ID: ${ROBINHOOD_CHAIN_ID_DEC})`;
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
