const { ethers } = require('ethers');

const NETWORKS = {
  mainnet: {
    networkKey: 'mainnet',
    networkId: 'robinhood-chain',
    chainId: 4663,
    name: 'Robinhood Chain',
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    testnet: false
  },
  testnet: {
    networkKey: 'testnet',
    networkId: 'robinhood-chain-testnet',
    chainId: 46630,
    name: 'Robinhood Chain Testnet',
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
    testnet: true
  }
};

const safeAddress = address => ethers.getAddress(address.toLowerCase());

function getRobinhoodChainConfig(requestedNetwork) {
  const networkKey = (requestedNetwork || 'mainnet').toLowerCase();
  if (!NETWORKS[networkKey]) throw new Error('Robinhood network must be "mainnet" or "testnet"');
  const network = NETWORKS[networkKey];
  const demoMode = process.env.X402_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
  const tokens = { ETH: { symbol: 'ETH', name: 'Ether', decimals: 18, address: null } };
  for (const [symbol, decimals] of [['USDC', 6], ['WETH', 18], ['X402PAY', 18]]) {
    const scopedKey = `ROBINHOOD_${networkKey.toUpperCase()}_${symbol}_CONTRACT_ADDRESS`;
    const legacyAddress = networkKey === 'mainnet' ? process.env[symbol + '_CONTRACT_ADDRESS'] : undefined;
    const address = process.env[scopedKey] || legacyAddress;
    if (address || (demoMode && symbol === 'USDC')) tokens[symbol] = { symbol, name: symbol, decimals, address: safeAddress(address || '0x0000000000000000000000000000000000000001') };
  }
  const configuredRpc = process.env[`ROBINHOOD_${networkKey.toUpperCase()}_RPC_URL`];
  return {
    ...network,
    caip2: `eip155:${network.chainId}`,
    networkType: 'Arbitrum Layer 2',
    publicRpcUrl: network.rpcUrl,
    rpcUrl: configuredRpc || (networkKey === (process.env.ROBINHOOD_NETWORK || 'mainnet').toLowerCase() ? process.env.ROBINHOOD_RPC_URL : null) || network.rpcUrl,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    supportedTokens: tokens, demoMode,
    paymentSchemes: [
      { id: 'onchain-tx', name: 'Confirmed on-chain transfer', status: 'active' },
      ...(demoMode ? [{ id: 'exact', name: 'Demo signed voucher (no funds moved)', status: 'demo' }, { id: 'sandbox', name: 'Demo simulation (no funds moved)', status: 'demo' }] : [])
    ],
    facilitatorAddress: safeAddress(process.env.FACILITATOR_WALLET || '0x71c808E5Bd568B74431b39C1D9e68C8BB9402E1a'),
    facilitatorFeeBps: 0, version: '1.3.0'
  };
}

const networkKey = (process.env.ROBINHOOD_NETWORK || 'mainnet').toLowerCase();
const ROBINHOOD_CHAIN_CONFIG = getRobinhoodChainConfig(networkKey);
module.exports = { NETWORKS, ROBINHOOD_CHAIN_CONFIG, getRobinhoodChainConfig, safeAddress };

