# Metered Orbio inference

## x402 escrow path (for the Olanas agent wallet)

This is the wallet-backed path used by the MCP `use_ai_model` tool. It is still
pending a funded end-to-end verification; do not advertise it to ordinary users
until a real deposit, model call, claim, and refund have been checked on-chain.

Operator setup on the website deployment:

1. Configure durable Turso storage, `VAULT_MASTER_SECRET`, and a funded
   `ORBIO_API_KEY` as for the existing backend. Never put Orbio's key in MCP or
   browser settings.
2. Set `OLANAS_ESCROW_PRIVATE_KEY` to a **dedicated** Robinhood Chain wallet.
   Fund this wallet with ETH for gas. It is the USDG receiver and the
   facilitator/authorizer signer. Never use a customer's or agent's private key.
3. Set a strong `CRON_SECRET`; Vercel uses it for the hourly private claim job.
4. Deploy and check `GET /api/inference/escrow/config`. Its `receiver` address
   must match the dedicated wallet. An unsigned POST to
   `/api/inference/escrow/chat/completions` should return HTTP 402 with
   `batch-settlement` on `eip155:4663` and canonical USDG.

Buyer setup:

1. Use native Olanas wallet mode. Fund the **local agent wallet** with at least
   $2 USDG on Robinhood Chain. The first call signs a gas-sponsored ERC-3009
   deposit into the x402 escrow contract; no separate Olanas prepaid key or
   advance transfer to the website is required.
2. Set `PAYMENTS_LAUNCHPAD_URL` to the deployed website URL. Enable an owner
   USDG spending policy for the `olanas-inference` service and the receiver
   returned by `/api/inference/escrow/config`. Set a per-call cap of at most $2.
3. Call `get_ai_balance`, then `use_ai_model` with a small priced text model,
   `max_tokens: 16`, and a stable `requestId`. Compare `olanas.chargedMicros`
   with Orbio analytics and the on-chain deposit. Reuse the same `requestId`
   after any uncertain response; never create a replacement request.
4. After the call is complete, call `refund_ai_escrow`. Verify the remaining
   USDG returns to the same agent wallet. An active/unknown call blocks refund
   and owner withdrawal until resolved.

The channel can also be reused for later model calls. The x402 authorization
ceiling is $2 per request, and a successful response bills the actual metered
usage below that ceiling. The hourly job batches server claims; cooperative
refund claims outstanding usage before returning the unused balance. Model
requests are text-only and non-streaming. This path is not a generic OpenAI SDK
proxy: use an x402-capable client such as the Olanas MCP.

## Legacy prepaid gateway (not the agent-wallet escrow path)

Olanas can serve text-only, non-streaming OpenAI-compatible Chat Completions through a **server-side** Orbio key. A buyer may add as little as **$0.01 USDG** on Robinhood Chain; there is no $5 Olanas minimum. Calls reserve a maximum amount before going upstream and release the unused portion after Orbio reports token usage. The user's remaining balance stays usable for later calls; withdrawal/refund and streaming are **not implemented** yet.

This feature is separate from the fixed-price service catalog and durable orders. It is not a direct, stateless x402 payment on every completion; it is a small prepaid meter backed by a confirmed on-chain payment. Do not advertise it as exact per-call x402 settlement.

## Operator setup

Set `ORBIO_API_KEY` and `OLANAS_INFERENCE_PAYOUT_ADDRESS` in the website's server environment. The Orbio key is never sent to clients. Production also needs the existing `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and a stable `VAULT_MASTER_SECRET` of at least 32 characters. Saved model responses are encrypted at rest for idempotent recovery, but are retained until manually purged. Fund the Orbio account first. Confirm that your Orbio agreement permits a third-party shared-key gateway before public launch.

## Buyer flow

1. GET `/api/inference/challenge`. Sign the exact returned `messageTemplate`, replacing `<address>` with the checksummed wallet address, using the Robinhood Chain wallet.
2. POST `/api/inference/keys` with `{"address":"0x…","nonce":"…","signature":"0x…"}`. Save the returned `oln_…` key. Repeating this procedure rotates the key and revokes the old one without losing balance.
3. GET `/api/inference/balance` using `Authorization: Bearer oln_…`. It returns the USDG payout address.
4. From the **same wallet**, transfer an amount between $0.01 and $1000 of Robinhood Chain USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`) to that address. Then POST `/api/inference/topups` with `{"txHash":"0x…","amountUsd":"2.50"}` and the same Bearer key. The server verifies the real transaction and credits it once; repeating the same transaction never credits it twice. ETH is needed for gas.
5. Point an OpenAI-compatible client to `https://YOUR_DOMAIN/api/inference/v1` with the `oln_…` key. Supply a model listed at `GET /api/inference/v1/models`, text messages, and an explicit `max_tokens` (1–4096). Set `stream: false`. Supported optional field: `temperature`. Example:

```js
import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: process.env.OLANAS_INFERENCE_API_KEY,
  baseURL: 'https://YOUR_DOMAIN/api/inference/v1',
});
const result = await client.chat.completions.create({
  model: 'anthropic/claude-fable-5.1',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 256,
  stream: false,
});
```

Olanas reserves a conservative maximum using the model's published Orbio pricing and the request size. It deducts reported prompt/completion token cost, not a flat per-call price. A response header `X-Olanas-Charged-Micros` reports the charge in millionths of a USD. For retried HTTP calls, send the **same** 8–100 character `Idempotency-Key`; a completed call is returned without another Orbio request. If an upstream result is ambiguous or lacks usage data, the reservation stays held for manual reconciliation; do not submit a new request key.

Limits: text only, Chat Completions only, no tools/vision/streaming, 16 KB request, 40 messages, $5 maximum reservation per call. No account withdrawal/refund UI yet. This is an MVP; real key, live USDG transaction, Orbio account funding, and Orbio reseller permission are needed for production validation.
