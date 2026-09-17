import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';

function PrivyBridgeInner() {
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
            await w.switchChain(4663);
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
  }, [login, logout, authenticated, user, ready, wallets]);

  return null;
}

export function initPrivy(appId = 'cmu5ionhg02ke0dl2kbo2amnp') {
  let container = document.getElementById('privy-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'privy-root';
    document.body.appendChild(container);
  }

  const root = createRoot(container);
  root.render(
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#059669',
          logo: '/logo.jpg',
          walletList: ['metamask', 'coinbase_wallet', 'rainbow', 'wallet_connect', 'detected_wallets']
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter', 'discord', 'apple'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          requireUserPasswordOnCreate: false
        },
        defaultChain: {
          id: 4663,
          name: 'Robinhood Chain',
          network: 'robinhood-chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
          blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } }
        },
        supportedChains: [
          {
            id: 4663,
            name: 'Robinhood Chain',
            network: 'robinhood-chain',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
            blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } }
          }
        ]
      }}
    >
      <PrivyBridgeInner />
    </PrivyProvider>
  );
}

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  window.initPrivyBridge = initPrivy;
  initPrivy('cmu5ionhg02ke0dl2kbo2amnp');
}
