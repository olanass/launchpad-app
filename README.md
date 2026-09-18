# x402-inspired content paywall

This application encrypts uploaded content and unlocks downloads after verifying a transfer on Robinhood Chain. It uses a custom HTTP 402 proof format; it is not a certified or drop-in standard x402 facilitator.

## Run

Use Node.js 22 or newer.

1. Run `npm ci`.
2. For a new installation only, copy `.env.example` to `.env`. Preserve an existing `.env` and vault key. Set `VAULT_MASTER_SECRET` to a random secret of at least 32 characters. For example, generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Set `PUBLIC_BASE_URL` to the externally accessible origin. Configure token contracts explicitly if accepting USDC, WETH, or another supported token. The default supports native ETH.
4. Optionally set `PRIVY_APP_ID` for authenticated browser wallet login.
5. Run `npm start`. This first builds the wallet bundle, then starts the server on port 4020.
6. Run `npm test` for isolated tests. They do not need RPC access, real wallet keys, or funds.

The generated Privy bundle is built from `privy-bridge-src.jsx` using the pinned esbuild WebAssembly compiler, which avoids native executable filesystem-access failures on this Windows environment. Run `npm run build` after editing that source. Direct browser wallets remain available when Privy is unavailable.

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

Uploads are limited to 25 MiB and are buffered for encryption and delivery. Use deployment-level request limits and storage quotas appropriate to your traffic. Optional IPFS pinning uploads ciphertext only. Browser P2P sharing is disabled.

Keep your existing `.env` and `uploads` when applying source changes. The repair archive deliberately excludes both. Do not generate a new key over existing encrypted files: preserve the original configured key or plan an explicit re-encryption migration. The old source had a published fallback key; archives encrypted with that fallback should be treated as requiring migration. Previously exposed previews or P2P copies cannot be recalled by this update.

Existing listings using old placeholder token addresses must be reviewed and configured against verified contracts before accepting payments. Existing sales totals in non-USDC currencies may need reconciliation because the old code labeled all proceeds as USD.

## Verification limits

The repair tests use mocked chain responses and browser providers. They cover validation, transfer matching, replay handling, persistence, private previews, encrypted text/binary downloads, checkout retry behavior, delivery preflight, wallet fallback, and chain switching. The compiled bundle and local Privy login modal have been checked. Authenticated Privy login, real wallet extensions, and live payment settlement still require end-to-end validation before use with funds.

Network settings retain chain ID 4663 and the mainnet RPC described in [Robinhood's network documentation](https://docs.robinhood.com/chain/add-network-to-wallet/).

