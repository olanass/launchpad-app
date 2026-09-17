const { ethers } = require('ethers');

/**
 * Robinhood Chain x402 Facilitator Configuration
 * Network: Robinhood Chain (Arbitrum Orbit L2)
 * Chain ID: 4663
 */

function safeAddress(addr) {
  try {
    return ethers.getAddress(addr.toLowerCase());
  } catch (e) {
    return addr;
  }
}

const ROBINHOOD_CHAIN_CONFIG = {
  chainId: 4663,
  caip2: 'eip155:4663',
  name: 'Robinhood Chain',
  networkType: 'Arbitrum Orbit Layer 2',
  rpcUrl: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  supportedTokens: {
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      address: safeAddress('0x2A9a7a91705E463a8a913DB28b97D81A942a197B'),
      decimals: 6,
      defaultRateUsd: 1.00
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: safeAddress('0x4200000000000000000000000000000000000006'),
      decimals: 18,
      defaultRateUsd: 3200.00
    },
    X402PAY: {
      symbol: 'X402PAY',
      name: 'x402 Protocol Token (Pons Launch)',
      address: safeAddress('0x4024024024024024024024024024024024024021'),
      decimals: 18,
      defaultRateUsd: 0.15,
      isPonsToken: true
    }
  },
  paymentSchemes: [
    {
      id: 'exact',
      name: 'Exact Payment Voucher',
      description: 'EIP-712 signed micropayment authorization with instant facilitator settlement',
      status: 'active'
    },
    {
      id: 'onchain-tx',
      name: 'Direct On-Chain Transaction',
      description: 'Transaction submitted directly to Robinhood Chain with hash verified by facilitator',
      status: 'active'
    },
    {
      id: 'sandbox',
      name: 'Instant Sandbox Simulation',
      description: 'Zero-gas test mode for rapid AI agent integration and developer testing',
      status: 'active'
    }
  ],
  facilitatorAddress: safeAddress(process.env.FACILITATOR_WALLET || '0x71c808E5Bd568B74431b39C1D9e68C8BB9402E1a'),
  facilitatorFeeBps: 50, // 0.5% facilitator fee
  version: '1.2.0'
};

module.exports = { ROBINHOOD_CHAIN_CONFIG, safeAddress };
