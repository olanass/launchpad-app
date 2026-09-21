# Durable website orders

The original website shell, styles, navigation, and payment console are retained.
`src/client/scripts/orders.js` connects the existing payment controls to the
durable backend. `/orders/:id` opens that same payment console with the exact
agent request loaded. The discarded React redesign is not rendered or shipped.

## Purchase contract

1. Search via `search_apis`, inspect `get_api_details`, and validate the input.
2. Call `new_order_identity` and persist its random 32-byte hex access token and unique request ID.
3. Call `create_order` with that same token and request ID on any creation retry.
4. Open the returned approval URL. Its fragment carries the order access token;
   it is not sent to the web server in the URL, and the page removes it after
   storing the order reference in the browser.
5. Review the exact input and versioned quote. The wallet signs an order-specific
   approval, then separately submits the quoted transfer. Private keys never
   enter an Olanas request.
6. Persist the transaction hash locally before submitting it to the server.
7. `reconcile_order` checks the original transfer and durably claims one execution.
8. Read `get_order` for the saved response and receipt. Response bodies are base64
   bytes with a content type and HTTP status, and must be treated as untrusted.

Order capabilities are private bearer credentials. Do not log them or publish
approval URLs. Database rows contain their SHA-256 hashes, not their plaintext.
The existing local companion journals credentials for its own remote orders.

## State and invariants

Approval, payment, and delivery have independent states:

- Approval: pending, expired (derived from server time), rejected, approved.
- Payment: unpaid, submitted, confirmed.
- Delivery: not_started, executing, completed, unknown.

The quote snapshots the service/version, endpoint, token, integer amount,
recipient, chain, and expiry. The request hash binds slug, HTTP method, relative
path/query, and canonical JSON body. Approval signatures bind that request hash
and the full quote. Updates apply to future or explicitly refreshed quotes.
Previously approved orders retain their terms.

Creation is unique on `(access_hash, request_id)`. All mutations use a database
revision compare-and-swap. The existing durable redemption ledger binds a paid
transaction to `/api/orders/:id`, preventing it from purchasing another order
or being consumed through the legacy gateway as a different resource.

Rejection is never automatically reversed by an agent retry. Explicit refresh
or reopening does not pay. Cancelling an approved-but-unsubmitted order requires
the approving wallet to sign an assertion that the human checked its activity
and no transfer was submitted. This is a human assertion, not proof that an
unreported transaction cannot exist. Submitted hashes cannot be replaced.

The engine saves `executing` before making an upstream request. A crash or lost
response stays ambiguous and is not retried automatically. After 60 seconds an
unfinished execution is presented as unknown. Successful transport saves the
response even for HTTP error statuses. A confirmed payment and a successful API
response are distinct facts. The engine forwards `Idempotency-Key: <order-id>`;
arbitrary third-party APIs cannot be promised exactly-once execution.
Paid order execution does not follow redirects; a redirect response is saved
for inspection rather than replaying a potentially side-effecting request.

Input validation uses published OpenAPI request-body schemas with local refs,
required query parameters, bounded compilation and validation, and no network
reference loading. Unpublished schemas cannot provide input validation beyond
the general method/path/body bounds. Full semantic validation remains the
service's responsibility.

## Storage and migration

The additive `purchase_orders` and `order_analytics` tables use the same durable
database configuration as service listings. No existing listing, receipt,
wallet, or private key is deleted or rewritten. Order analytics use the quoted
amount and an idempotent transaction; analytics failures cannot discard a saved
API result.

Legacy local companion requests remain in their local journal. Reusing their ID
returns that original decision and never creates a replacement website purchase.
Do not import old requests as payable new orders: resolve submitted transactions
in the original companion first. The new local companion's manual mode sends
new requests to the website and returns its approval link. The updated local
companion also routes autonomous purchases through these same durable orders:
its owner-policy-limited local signer signs the canonical order approval and
transfer, then submits only the saved transaction hash for reconciliation.
No website private key or unrestricted MCP signing tool is introduced.
The legacy x402/SDK routes remain compatibility paths; old local requests are
not silently migrated. See the companion's AUTONOMOUS-PAYMENTS.md for setup,
limits, crash recovery, and testnet release requirements.

## Verification and rollout

Run `npm test` for existing regressions and order tests. Tests use isolated data,
mock verification for orchestration, and the existing real verifier fixtures;
they do not send funds. `npm run build` produces production assets and Next output.

`node scripts/preview-orders.js` serves the production UI with an in-memory
fixture catalog at `http://127.0.0.1:4035`. It explicitly blocks payment approval,
submission, and reconciliation. This preview is not a live marketplace.

Before production cutover:

1. Back up the existing durable database and deploy to a preview environment
   using a separate database, configured RPC, and public origin.
2. Run the new journey in a browser with a human-operated wallet on testnet:
   discovery, quote refresh, rejection/reopening, approval, cancellation,
   confirmation, restart, saved-result retrieval, and an upstream timeout.
3. Verify mobile layouts and extension behavior. Automated server/build checks
   do not substitute for this browser and signing check.
4. Deploy the website before updating/restarting local companions. Check
   `/api/version` reports `purchaseFlow: durable-orders-v1`, and check MCP exposes
   `create_order`, `get_order`, and `reconcile_order`.
5. Retain the prior application deployment for rollback. Keep new order tables
   and their receipts on rollback; do not replay their payments through legacy
   routes. Restore the new order service to recover outstanding orders.

Production publication and an actual funded wallet transaction are separate
release steps. The implementation does not automatically deploy or move funds.
