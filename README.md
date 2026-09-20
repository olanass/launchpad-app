# Robinhood Chain API launchpad and x402-inspired paywall

The application runs on Next.js 16 with the App Router. Next.js owns the page shell, metadata, catch-all product routes, asset delivery, development server, and production build. The existing Express routers remain mounted inside the custom Next.js server for payment verification, multipart uploads, x402 proxying, and storage; this preserves the audited middleware behavior while giving the project one runtime and one entry point.

This application lets developers publish an existing HTTP endpoint as a paid API on Robinhood Chain. It creates a public listing, an HTTP 402 gateway, on-chain payment verification, durable usage analytics, logo and video metadata, and wallet-signed creator controls. The repository also contains the original encrypted-content paywall.

The launchpad exposes an x402 v2-shaped discovery and challenge envelope using the confirmed-transaction scheme. Buyers submit a mined Robinhood Chain transaction as proof. This is honest x402-compatible metadata, but it is not the standard exact scheme and does not submit or settle a transaction for the buyer.

## API launchpad

### Local Robinhood Payments MCP

The separate [Payments MCP companion](payments-mcp/README.md) lets an MCP coding
client discover launchpad APIs, queue user-approved payments, inspect balances,
and retrieve results. Its browser wallet UI supports funding details and sending
unused funds out on Robinhood. Native Olanas wallet mode generates an encrypted
local keystore and signs autonomous payments locally under owner-enabled session
budgets. Install and configure it for Codex in one command:

```powershell
npx --yes github:olanass/launchpad-app --client codex --auto-config
```

From a cloned repository, use `npm run payments:install`. The installer creates the wallet
and configures Codex without API keys or seed phrases. Optional browser-wallet mode starts
with `npm run payments:wallet`. Run `npm run test:payments` for both modes.
No hosted custody service or fiat onramp is included.
It runs locally, independently of the website deployment.

Developers connect a wallet, paste a public API URL, choose one or more HTTP methods, set a per-request price, optionally upload a logo, OpenAPI JSON, and video URL, and sign the listing. The platform publishes the API at `/x402/:slug`.

On a paid request:

1. The gateway returns HTTP 402 with a `PAYMENT-REQUIRED` challenge when proof is missing.
2. The client transfers the exact listed amount to the developer payout address on Robinhood Chain.
3. The client retries with its base64 payment proof in `PAYMENT-SIGNATURE`.
4. The server verifies the mined transfer, reserves the receipt, and proxies the request to the developer endpoint.
5. Only a successful upstream response counts as a paid request and revenue. A failed upstream response releases that payment proof for a retry.

USDG is the default stable payment token. Its canonical Robinhood Chain address is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, with 6 decimals. Other currencies are available only when their verified contract addresses are explicitly configured.

### Launchpad API

- `POST /api/services`: create a wallet-signed service listing.
- `GET /api/services`: browse and search listings.
- `GET /api/services/:slug`: public listing and live analytics.
- `GET /api/services/creator/:address`: services owned by a creator wallet.
- `GET /api/services/:slug/logo`: durable uploaded logo.
- `GET /api/services/:slug/openapi.json`: optional public schema rewritten to the paid gateway.
- `GET /api/services/:slug/health`: check the upstream endpoint.
- `PATCH /api/services/:slug`: wallet-signed update, pause, or resume.
- `DELETE /api/services/:slug`: wallet-signed deletion.
- `GET /discovery/resources`: x402 v2-shaped discovery metadata for all live APIs.
- `GET|POST|PUT|PATCH|DELETE /x402/:slug/*`: paid API gateway, limited to the methods selected by the creator.
- `POST /mcp`: stateless MCP tools for discovery, requirements, gateway calls, balances, and receipts.
- `GET /llms.txt` and `GET /docs/:page.md`: AI-readable documentation.

The guarded Node client in `sdk/index.js` accepts an injected ethers signer (or an explicit server-side key and RPC), service/token allowlists, per-call limits, daily budgets, and a payment approval callback. It does not generate, request, transmit, or persist wallet secrets. See `/docs/developers/agents` for usage.

Creation and management signatures are bound to the exact listing/action payload and expire after five minutes. Endpoint validation rejects private, loopback, link-local, and otherwise unsafe destinations.

## Run

Use Node.js 22 or newer.

1. Run `npm ci`.
2. For a new installation only, copy `.env.example` to `.env`. Preserve an existing `.env` and vault key. Set `VAULT_MASTER_SECRET` to a random secret of at least 32 characters. For example, generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Set `PUBLIC_BASE_URL` to the externally accessible origin. Configure token contracts explicitly if accepting USDC, WETH, or another supported token. The default supports native ETH.
4. Optionally set `PRIVY_APP_ID` for authenticated browser wallet login.
5. Run `npm start`. This builds the browser assets and optimized Next.js application, then starts the production server on port 4020.
6. Use `npm run dev` for local Next.js development with automatic server restarts.
7. Run `npm test` for isolated tests. They do not need RPC access, real wallet keys, or funds.

For local launchpad development, the service catalog uses `uploads/launchpad.db`. Production deliberately fails closed unless `TURSO_DATABASE_URL` is set. Set `TURSO_AUTH_TOKEN` as well when the database requires authentication. This prevents listings, logos, receipts, and analytics from disappearing across serverless instances or deployments.

The generated Privy bundle is built from `src/client/integrations/privy-bridge.jsx` using the pinned esbuild WebAssembly compiler. Run `npm run build` after editing that source. Direct browser wallets remain available when Privy is unavailable.

## Robinhood Chain Testnet

To run mainnet and testnet together with the website network selector, use:

```bash
npm run dev:networks
```

This starts the isolated mainnet app on `http://localhost:4020` and testnet app on `http://localhost:4021`. The selector switches the connected wallet first, then moves to the matching app. Set `ROBINHOOD_MAINNET_APP_URL` and `ROBINHOOD_TESTNET_APP_URL` when the two environments are deployed at different public URLs.

Run the application against Robinhood Chain Testnet with:

```powershell
npm run dev:testnet
```

The testnet configuration uses chain ID `46630`, the public testnet RPC, the testnet explorer, and a separate `uploads-testnet` data directory. The wallet button will add or switch MetaMask to the correct network, and the UI displays an amber testnet warning.

ETH is available by default as the testnet payment currency. Configure ERC-20 currencies only with verified testnet contract addresses using the `ROBINHOOD_TESTNET_*_CONTRACT_ADDRESS` variables. Testnet assets have no monetary value and must never be represented as mainnet funds.

For a dedicated testnet environment file, copy `.env.testnet.example` to `.env` only if you do not need to preserve an existing `.env`. Otherwise, add the desired testnet variables to the existing file and keep its vault secret.

## Project structure

- `app`: Next.js App Router pages, metadata, global styling, and browser-runtime bootstrap.
- `server.js`: shared Next.js and API server entry point.
- `src/client`: browser assets, application modules, styles, and wallet integration loaded by the Next.js page shell.
- `src/server`: Express API routers, payment verification, paywall services, and encrypted storage mounted by the Next.js server.
- `tests`: regression and live smoke tests.
- `scripts`: build-time utilities.
- `docs`: architecture and maintenance documentation.

See [`docs/architecture.md`](docs/architecture.md) for module boundaries and data flow.

## Deployment

Deploy this repository to a Node.js 22 host that runs `npm run build` and `npm start`. The project uses a custom Next.js server because the x402 gateway needs streaming proxy requests, Express middleware, multipart uploads, and the existing payment-verification pipeline in the same process. Keep the configured Turso database and vault storage available to every production instance.

Vercel uses the Next.js framework preset from `vercel.json`. The API adapter in `pages/api/[[...path]].js` mounts the existing Express backend with body parsing disabled so multipart and paid proxy requests keep their original bodies. Next.js rewrites `/x402`, `/facilitator`, `/discovery`, `/agent-runner`, and `/mcp` to this adapter. Local `npm start` also supports the custom server. The deployment must include the same production Turso configuration and existing vault secret; do not generate replacement secrets during migration. Temporary serverless storage is not durable storage for encrypted content uploads.

Use `olanass/launchpad-app` as the Vercel Git repository, `main` as the production branch, and the repository root as the root directory. Assign `olanas.xyz` to this project only after its production APIs have been verified. `/api/version` reports the deployed repository and Vercel commit SHA, making a domain pointing at an older project visible. Run `BASE_URL=<deployment-origin> npm run test:deployment` against the deployed site (set `BASE_URL` with your shell's environment syntax).

## Documentation portal

The website serves the Olanas documentation at `/docs`. The reviewed Mintlify source from [`olanass/docs`](https://github.com/olanass/docs) is vendored under `docs/site`. During `npm run build`, `scripts/build-docs.js` converts its navigation and MDX components into the searchable in-app documentation bundle and copies the documentation assets.

The imported snapshot is recorded in `docs/site/.source-commit`. When the source repository changes, review the new claims and links before replacing the snapshot, then run `npm run build` and the regression tests.

## Payment behavior

The buyer sends the exact listed amount in the listed currency to the creator. ETH transfers are checked against the actual transaction recipient and value. ERC-20 transfers are checked against the configured contract's Transfer events, sender, recipient, and amount. The server checks the network and requires a successful mined transaction.

The confirmed transaction hash and payer address form the payment proof. Redemptions persist under the data directory. A payment can be reused for the same payer, resource, token, amount, and recipient to recover an interrupted download; it cannot buy another requirement.

Payments transfer directly to the creator. This implementation does not deduct a facilitator fee or submit transactions on behalf of a buyer. Unsupported or unconfigured currencies fail closed.

The browser retains pending transaction hashes within the tab so a timeout does not cause another transfer. The server polls its configured Robinhood RPC and Blockscout for confirmation. Wallet switching and transaction replacement still require manual attention; no replacement transaction is sent automatically.

## API

- `POST /api/paywalls/create`: multipart file or text, title, description, decimal price string, currency, creatorAddress, creatorTimestamp, creatorSignature.
- `GET /api/paywalls/:id`: public metadata without content, vault paths, hashes of plaintext, encryption parameters, or creator signatures.
- `GET /api/paywalls/creator/:address`: public metadata and sales totals for a creator.
- `GET /api/paywalls/:id/download`: HTTP 402 challenge, then a verified download.
- `GET /api/paywalls/gas-estimate`: RPC gas estimate or explicit unavailable result. USD prices are not invented.
- `GET /facilitator/supported`: configured tokens and schemes.
- `POST /facilitator/verify`: read-only verification of paymentProof and requirement.
- `POST /facilitator/settle`: verification plus durable receipt, with optional metadata.
- `GET /facilitator/receipts/:id`: receipt lookup.
- `GET /facilitator/analytics`: ledger analytics. USD totals include real USDC transfers only.
- `GET /api/privy/config`: public browser login configuration.

Legacy email-only wallet creation endpoints return 410. An email string is not authentication, and no invented wallet addresses are returned.

### Creator signature

Sign this exact string using personal_sign:

```js
'x402 create paywall\n' + JSON.stringify({
  title,
  description,
  price,                         // decimal string, unchanged
  currency,                      // supported uppercase symbol
  creatorAddress: creatorAddress.toLowerCase(),
  contentHash,                   // SHA-256 hex of exact uploaded bytes
  timestamp: creatorTimestamp    // milliseconds as a string
})
```

Field order matters. The timestamp must be within five minutes. Cancellation, content changes, invalid signatures, and creation replays are rejected.

### Download proof

After receiving the challenge and submitting the transfer, send the transaction hash and payer address:

```js
const proof = { scheme: 'onchain-tx', txHash, payer };
// Send base64(JSON.stringify(proof)) as PAYMENT-SIGNATURE.
```

On success, PAYMENT-RESPONSE contains a base64 JSON receipt. Save the proof and receipt to recover the same download if needed.

## Demo mode

Set `X402_DEMO_MODE=true` only in an isolated development vault. `NODE_ENV=production` always disables demo proofs. Demo exact/sandbox receipts say simulated, contain no fabricated transaction hash, and move no funds. The bundled AgentClient supports these demo signed vouchers only.

Demo API routes and the allowlisted agent runner are unavailable outside demo mode. The browser never sends a real transfer while demo mode is enabled.

## Storage and migration

Run one server process per data directory. Paywall metadata uses synchronous atomic replacement; this is not a multi-worker database. Redemption claims use exclusive file creation. Back up the entire data directory and its encryption secret together.

Launchpad data is separate from paywall data. It uses libSQL locally and Turso in production. Its service records, uploaded logos, receipt reservations, payment redemptions, and analytics are durable and safe to share across concurrent serverless instances. Configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in every production environment before deploying this version.

Uploads are limited to 25 MiB and are buffered for encryption and delivery. Use deployment-level request limits and storage quotas appropriate to your traffic. Optional IPFS pinning uploads ciphertext only. Browser P2P sharing is disabled.

Keep your existing `.env` and `uploads` when applying source changes. The repair archive deliberately excludes both. Do not generate a new key over existing encrypted files: preserve the original configured key or plan an explicit re-encryption migration. The old source had a published fallback key; archives encrypted with that fallback should be treated as requiring migration. Previously exposed previews or P2P copies cannot be recalled by this update.

Existing listings using old placeholder token addresses must be reviewed and configured against verified contracts before accepting payments. Existing sales totals in non-USDC currencies may need reconciliation because the old code labeled all proceeds as USD.

## Verification limits

The repair tests use mocked chain responses and browser providers. They cover validation, transfer matching, replay handling, persistence, private previews, encrypted text/binary downloads, checkout retry behavior, delivery preflight, wallet fallback, and chain switching. The compiled bundle and local Privy login modal have been checked. Authenticated Privy login, real wallet extensions, and live payment settlement still require end-to-end validation before use with funds.

Network settings support mainnet chain ID `4663` and testnet chain ID `46630` as described in [Robinhood's network documentation](https://docs.robinhood.com/chain/add-network-to-wallet/).

