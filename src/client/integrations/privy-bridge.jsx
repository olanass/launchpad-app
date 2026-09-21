import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';

function PrivyBridgeInner({ chainId }) {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  useEffect(() => {
    window.__privy = {
      login,
      logout,
      authenticated,
      user,
      ready,
      wallets,
      getProvider: async () => {
        if (wallets && wallets.length > 0) {
          const w = wallets[0];
          try {
            await w.switchChain(chainId);
          } catch (e) {}
          return await w.getEthereumProvider();
        }
        return window.ethereum || null;
      }
    };

    if (ready) {
      window.dispatchEvent(new CustomEvent('privy:ready', {
        detail: { ready, authenticated, user, wallets }
      }));
    }

    if (authenticated && user) {
      window.dispatchEvent(new CustomEvent('privy:authenticated', {
        detail: { user, wallets }
      }));
    }
  }, [login, logout, authenticated, user, ready, wallets, chainId]);

  return null;
}

let bridgeRoot;
export async function initPrivy(appId) {
  if (bridgeRoot) return;
  const response = await fetch('/api/privy/config', { cache: 'no-store' });
  const serverConfig = await response.json();
  if (!appId) appId = serverConfig.appId;
  if (!serverConfig.configured || !appId) return;

  const chain = serverConfig.chain;
  if (chain?.chainId !== 4663 || chain.networkKey !== 'mainnet' || chain.testnet) throw new Error('Olanas supports mainnet only');
  const privyChain = {
    id: chain.chainId,
    name: chain.name,
    network: chain.networkId,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    blockExplorers: { default: { name: 'Blockscout', url: chain.explorerUrl } }
  };
  if (bridgeRoot) return;
  let container = document.getElementById('privy-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'privy-root';
    document.body.appendChild(container);
  }

  bridgeRoot = createRoot(container);
  bridgeRoot.render(
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#059669',
          logo: '/assets/logo.jpg',
          walletList: ['metamask', 'coinbase_wallet', 'rainbow', 'wallet_connect', 'detected_wallets']
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter', 'discord', 'apple'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          requireUserPasswordOnCreate: false
        },
        defaultChain: privyChain,
        supportedChains: [privyChain]
      }}
    >
      <PrivyBridgeInner chainId={chain.chainId} />
    </PrivyProvider>
  );
}

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  window.initPrivyBridge = initPrivy;
  initPrivy().catch(err => console.warn('Wallet login unavailable:', err.message));
}
