---
title: "Application architecture"
description: "Runtime boundaries, modules, persistence, and testing for the Olanas application."
---

# Application architecture

The application is a single Node.js service with a static browser client. The organization reflects runtime responsibilities rather than pretending each folder is an independent npm package.

## Runtime flow

1. `src/server/index.js` loads local environment values and starts the HTTP server.
2. `src/server/app.js` composes the API routers and serves `src/client`.
3. The browser client creates signed paywall listings and submits them to the paywall API.
4. Content is encrypted before it is persisted under the configured data directory.
5. Download requests pass through payment verification and redemption tracking before content is decrypted.

## Server modules

- `agent`: demo agent client and its allowlisted runner endpoint.
- `auth`: public Privy configuration and retired legacy endpoints.
- `config`: environment loading, shared filesystem paths, and chain configuration.
- `demo`: demo-only monetized endpoints.
- `facilitator`: amount parsing, verification, settlement, receipts, and analytics.
- `middleware`: reusable HTTP 402 request handling.
- `paywall`: listing creation, metadata lookup, and protected downloads.
- `vault`: encrypted local storage and optional IPFS pinning.

`src/server/config/paths.js` owns project, client, and data paths. Feature modules should not calculate paths relative to their own source directories.

`ROBINHOOD_NETWORK` selects `mainnet` or `testnet`. The selected chain configuration is exposed to the browser through `/api/privy/config`, keeping wallet switching, checkout challenges, verification, explorer links, and UI labels aligned. Testnet storage is always isolated through `ROBINHOOD_TESTNET_DATA_DIR` or the default `uploads-testnet` directory.

## Client modules

- `assets`: images and icons copied as static files.
- `integrations`: source code for third-party browser integrations.
- `generated`: build output; never edit or commit it.
- `scripts`: browser behavior split into navigation, network, wallet, creator, checkout, and dashboard responsibilities.
- `styles`: ordered design-system, feature, dialog, and responsive styles loaded by `app.css`.

The browser application remains framework-light. Keep shared state and startup wiring in `scripts/app.js`; feature behavior belongs in the matching responsibility file.

## Tests

`tests/regression.test.js` runs without a live chain or funded wallet. Test names are grouped by `production:`, `handshake:`, `paywall:`, and `browser:` prefixes, with matching npm scripts.

`tests/smoke/verify-link.js` checks a running deployment and requires a paywall ID.

## Persistent data

The default data directory remains `<project>/uploads`. Set `X402_DATA_DIR` to use another absolute or relative location. Back up the encrypted assets and the configured vault secret together.
