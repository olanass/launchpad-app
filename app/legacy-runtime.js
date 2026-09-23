'use client';

import { useEffect } from 'react';

const classicScripts = [
  '/scripts/theme.js',
  '/scripts/app.js',
  '/scripts/navigation.js',
  '/scripts/network.js',
  '/scripts/wallet.js',
  '/scripts/gas.js',
  '/scripts/creator.js',
  '/scripts/services.js?v=amount-only-20260923',
  '/scripts/payments.js',
  '/generated/orders-wallet.bundle.js',
  '/scripts/orders.js',
  '/scripts/checkout.js',
  '/scripts/dashboard.js',
  '/generated/docs-content.js',
  '/scripts/docs-portal.js',
  '/generated/privy-bridge.bundle.js'
];

function loadScript(src, type = 'text/javascript') {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-next-runtime="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.type = type;
    script.dataset.nextRuntime = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.body.appendChild(script);
  });
}

export default function LegacyRuntime() {
  useEffect(() => {
    let active = true;
    (async () => {
      for (const src of classicScripts) await loadScript(src);
      if (!active) return;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await loadScript('/scripts/cosmos-background.js', 'module');
    })().catch(error => console.error('Client runtime failed to start:', error));
    return () => { active = false; };
  }, []);

  return null;
}
