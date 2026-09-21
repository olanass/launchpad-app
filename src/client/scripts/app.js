/**
 * x402 Paywall — Production Client Application
 * Platform: Robinhood Chain (network selected by the server)
 */

// CRITICAL: Capture the real MetaMask provider NOW, before Privy SDK
// can override window.ethereum with its own slow proxy.
const _metamask = window.ethereum;

// Official Robinhood Chain Parameters
let ROBINHOOD_CHAIN_ID_DEC = 4663;
let ROBINHOOD_CHAIN_ID_HEX = '0x1237';
let ROBINHOOD_CHAIN_NAME = 'Robinhood Chain';
let ROBINHOOD_NETWORK_KEY = 'mainnet';
let ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
let ROBINHOOD_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';
let ROBINHOOD_NETWORKS = [];

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
  activeView: 'service-launch',
  checkoutMode: 'web3', // 'web3' | 'sandbox'
  isOnRobinhood: true
};

async function loadNetworkConfig() {
  try {
    const response = await fetch('/api/privy/config', { cache: 'no-store' });
    const body = await response.json();
    const chain = body.chain;
    if (!response.ok || !chain || !Number.isSafeInteger(chain.chainId)) throw new Error('Invalid network configuration');
    if (chain.chainId !== 4663 || chain.networkKey !== 'mainnet' || chain.testnet) throw new Error('Olanas supports mainnet only');

    ROBINHOOD_CHAIN_ID_DEC = chain.chainId;
    ROBINHOOD_CHAIN_ID_HEX = `0x${chain.chainId.toString(16)}`;
    ROBINHOOD_CHAIN_NAME = chain.name;
    ROBINHOOD_NETWORK_KEY = chain.networkKey;
    ROBINHOOD_RPC_URL = chain.rpcUrl;
    ROBINHOOD_EXPLORER_URL = chain.explorerUrl;
    ROBINHOOD_NETWORKS = [chain];
    Object.assign(ROBINHOOD_CHAIN_PARAMS, {
      chainId: ROBINHOOD_CHAIN_ID_HEX,
      chainName: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: [chain.rpcUrl],
      blockExplorerUrls: [chain.explorerUrl]
    });

    document.body.dataset.network = chain.networkKey;
    const explorer = document.getElementById('footerExplorerLink');
    if (explorer) explorer.href = chain.explorerUrl;
    const labels = {
      walletNetworkLabel: `${chain.name} (${chain.chainId})`,
      creatorChainBadge: `Chain ID: ${chain.chainId}`,
      checkoutNetworkBadge: `${chain.name} (${chain.chainId})`,
      successNetworkLabel: chain.name,
      footerNetworkLabel: `Powered by ${chain.name} (${chain.networkType}, ID: ${chain.chainId})`
    };
    for (const [id, value] of Object.entries(labels)) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }
  } catch (error) {
    console.warn('Using bundled mainnet network defaults:', error.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.title = 'x402 Launchpad - Paid APIs on Robinhood Chain';
  initAppNoticeModal();
  await loadNetworkConfig();
  initNetworkSelector();
  initNavigation();
  loadAvailableCurrencies();
  initPrivyWallet();
  initFileUpload();
  initGasPolling();
  initPaywallCreation();
  initServiceLaunchpad();
  initPaymentConsole();
  initPaywallViewRouting();
  initNetworkStatusListener();
  initDocsPortal();
  restoreSession();
});
