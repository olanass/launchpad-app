---
title: "Application architecture"
description: "How the API launchpad, MCP tools, orders, and payment verification fit together."
---

## Runtime

The website uses a Next.js application shell with browser feature scripts and an Express backend. `server.js` prepares Next and mounts the backend locally. Vercel routes API requests through the serverless entry in `pages/api/[[...path]].js`.

The browser provides Launch API, Explore, Pay & run, My projects, Sell files, and Docs. Projects host their own API implementations outside this application.

## API request path

1. A creator signs a listing for an existing endpoint.
2. The service catalog stores its public metadata, pricing, schema, and private upstream configuration.
3. An agent discovers the service through MCP or HTTP.
4. A durable order binds a request to a versioned quote and approval.
5. The verifier checks the submitted Robinhood Chain transaction.
6. The order engine calls the upstream endpoint and saves the response.
7. The agent reads the original order to retrieve its result.

The direct `/x402/:slug` gateway is a separate proof-based integration path. See [Payment flow](/developers/payment-flow) for its different retry behavior.

## Server modules

| Module | Responsibility |
| --- | --- |
| `services` | Signed listings, discovery, OpenAPI, endpoint checks, proxying, and catalog storage. |
| `orders` | Quotes, request validation, approvals, submitted payments, execution, and saved results. |
| `mcp` | Remote discovery, order, balance, requirement, call, and receipt tools. |
| `facilitator` | Amount parsing, confirmed-transfer verification, settlement, and replay protection. |
| `auth` | Public wallet-login configuration. |
| `config` | Mainnet configuration, environment loading, and paths. |
| `paywall` and `vault` | Separate encrypted file/text listings and paid downloads. |

## Persistence and credentials

Catalog data, order state, receipts, and analytics use libSQL/Turso-backed storage. Production requires the configured durable database. File-paywall assets use encrypted storage and optional ciphertext-only IPFS pinning; those storage requirements are separate from the API catalog.

Order access tokens are private bearer credentials. Database records store their hashes. Clients must retain the original token to recover private order results.

The local wallet companion is a separate runtime. It holds its encrypted wallet and spending-session policy locally; the website receives signatures and transaction proofs, not the wallet key.

## Documentation build

Source pages live in `docs/site`. The build generates the browser content bundle, Markdown downloads, and `/llms.txt`. Edit source pages rather than generated files.

The Markdown homepage is published at `/docs/home.md` so it cannot shadow the HTML interface at `/docs`.

## Local development

```sh
npm ci
npm run build:assets
npm run dev
```

The local website runs at `http://localhost:4020`. It is configured for mainnet; use the isolated automated tests for non-spending integration checks.

Run `npm test` for API, payment, and order regressions. Run `npm run build` for production assets and Next output. Automated tests do not prove live wallet interoperability or third-party endpoint reliability.
