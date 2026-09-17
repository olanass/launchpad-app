# x402 Payment Facilitator on Robinhood Chain

> A production-grade implementation of the **HTTP 402 Payment Required** standard (inspired by [PayAI.network](https://payai.network/)) specifically built for **Robinhood Chain** (Arbitrum Orbit Layer 2, Chain ID: 4663).

![Robinhood Chain x402](https://img.shields.io/badge/Robinhood_Chain-Chain_ID_4663-00c805?style=for-the-badge)
![EVM Compatible](https://img.shields.io/badge/EVM-Arbitrum_Orbit_L2-00e5ff?style=for-the-badge)
![Status](https://img.shields.io/badge/Protocol-x402_Active-4d63f6?style=for-the-badge)

---

## ⚡ Overview

The **x402 protocol** activates the dormant HTTP `402 Payment Required` status code to enable **per-request micropayments** for AI agents and Web3 APIs. 
- **No accounts or signup forms**
- **No credit card billing contracts**
- **No API key management or rate-limit tokens**
- **Sub-second finality** on Robinhood Chain's Arbitrum Orbit L2 with gas fees `<$0.0001` per transaction.

---

## 🏗️ Architecture

```
                                      ┌──────────────────────────────────────┐
                                      │       Autonomous AI Agent / Client   │
                                      │   - Holds wallet on RH Chain (4663)  │
                                      │   - Catches HTTP 402                 │
                                      │   - Signs payment & retries          │
                                      └──────────────────┬───────────────────┘
                                                         │
                             1. Request /api/compute     │ 3. Retry with PAYMENT-SIGNATURE
                                                         ▼
                                      ┌──────────────────────────────────────┐
                                      │         Monetized Resource API       │
                                      │   (Protected by x402 Middleware)     │
                                      │   - Returns 402 if unpaid            │
                                      │   - Validates via Facilitator        │
                                      └──────────────────┬───────────────────┘
                                                         │
                                        4. Verify/Settle │
                                                         ▼
┌─────────────────────────────────────┐       ┌──────────────────────────────────────┐
│       PayAI-Style Web Portal        │◄──────┤       x402 Facilitator Service       │
│  - Live 402 Handshake Playground    │       │  - POST /verify                      │
│  - Merchant API Configurator        │       │  - POST /settle                      │
│  - Real-time Transaction Ledger     │       │  - GET /supported                    │
│  - Pons Bonding Curve & Pair Hub    │       │  - Robinhood Chain RPC Provider      │
└─────────────────────────────────────┘       └──────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Install & Run
```bash
# Start the server (Facilitator + Protected AI APIs + Web Dashboard)
npm start
```

The system will start online at **`http://localhost:4020`**.

### 2. Run Automated Protocol Tests
```bash
npm test
```
Executes the complete test suite verifying HTTP 402 challenges, EIP-712 typed signatures, autonomous agent payer retry, and settlement ledger recording.

---

## 🌐 Robinhood Chain Parameters

| Parameter | Specification |
|---|---|
| **Network Name** | Robinhood Chain |
| **Architecture** | Arbitrum Orbit Layer 2 (EVM) |
| **Chain ID** | `4663` |
| **CAIP-2 Identifier** | `eip155:4663` |
| **Native Gas Token** | ETH |
| **RPC Endpoint** | `https://rpc.mainnet.chain.robinhood.com` |
| **Block Explorer** | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Settlement Tokens** | USDC (`0x2A9a7a91705E463a8a913DB28b97D81A942a197B`), WETH, `$X402PAY` |

---

## 🎯 Pons Launchpad Strategy (`$X402PAY / WETH`)

Pons ([ponsfamily.com/launchpad](https://www.ponsfamily.com/launchpad)) is the leading launchpad on Robinhood Chain.

### The Mechanism
1. **Deploy**: Fixed-supply token (`$X402PAY`) deployed for ~0.0005 ETH.
2. **Bonding Curve**: Initial price discovery through algorithmically priced deposits in WETH.
3. **Graduation**: Once target WETH is met (e.g., 22 WETH), the token graduates to **Uniswap V4** with permanently locked liquidity.
4. **Creator Fee Accrual**: The creator receives **70% of the 1% trading fee** on all volume of the token on Pons!
5. **Token Utility**: Staking for protocol revenue share and discounted facilitator fees on x402 micropayments.

---

## 📡 API Reference

### Facilitator Endpoints
- `GET /facilitator/supported`: Lists supported networks, payment schemes, and tokens (PayAI specification).
- `POST /facilitator/verify`: Validates client signature against payment requirement.
- `POST /facilitator/settle`: Verifies, clears settlement, and returns cryptographic receipt.
- `GET /facilitator/receipts/:id`: Query verified receipt by ID (`rcpt_rh_...`).
- `GET /facilitator/analytics`: Real-time transaction count, settled volume, and gas savings.

### Sample Monetized Endpoints
- `GET /api/v1/market/robinhood-pulse` — Cost: **0.002 USDC**
- `POST /api/v1/agent/inference` — Cost: **0.005 USDC**
- `GET /api/v1/agent/task-runner` — Cost: **0.010 USDC**

---

## 💻 Merchant Integration (Drop-in Middleware)

```javascript
const express = require('express');
const { x402 } = require('./packages/middleware/x402');

const app = express();

// Protect endpoint with x402 on Robinhood Chain
app.get('/api/my-ai-model', x402({
  price: '0.005',
  token: 'USDC',
  recipient: '0x3E8f2038AC4B30f9a6f3B06E1A6FAC29A6b2F89b',
  scheme: 'exact',
  facilitatorUrl: 'http://localhost:4020/facilitator'
}), (req, res) => {
  res.json({
    data: "Protected inference result delivered!",
    receipt: req.x402.receipt
  });
});
```

---

## 🤖 Autonomous Client Integration

```javascript
const { AgentClient } = require('./packages/agent-client/client');

const agent = new AgentClient({
  baseUrl: 'http://localhost:4020'
});

// Automatically intercepts HTTP 402, signs payment, and delivers data
const { data, receipt } = await agent.fetchWith402('/api/v1/market/robinhood-pulse');
console.log('Result:', data);
console.log('Receipt ID:', receipt.receiptId);
```
