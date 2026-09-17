const { ethers } = require('ethers');
const demoMode = process.env.X402_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
const safeAddress = address => ethers.getAddress(address.toLowerCase());
const tokens = { ETH: { symbol: 'ETH', name: 'Ether', decimals: 18, address: null } };
for (const [symbol, decimals] of [['USDC', 6], ['WETH', 18], ['X402PAY', 18]]) {
  const address = process.env[symbol + '_CONTRACT_ADDRESS'];
  if (address || (demoMode && symbol === 'USDC')) tokens[symbol] = { symbol, name: symbol, decimals, address: safeAddress(address || '0x0000000000000000000000000000000000000001') };
}
const ROBINHOOD_CHAIN_CONFIG = {
  chainId: 4663, caip2: 'eip155:4663', name: 'Robinhood Chain', networkType: 'Arbitrum Orbit Layer 2',
  rpcUrl: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  supportedTokens: tokens, demoMode,
  paymentSchemes: [
    { id: 'onchain-tx', name: 'Confirmed on-chain transfer', status: 'active' },
    ...(demoMode ? [{ id: 'exact', name: 'Demo signed voucher (no funds moved)', status: 'demo' }, { id: 'sandbox', name: 'Demo simulation (no funds moved)', status: 'demo' }] : [])
  ],
  facilitatorAddress: safeAddress(process.env.FACILITATOR_WALLET || '0x71c808E5Bd568B74431b39C1D9e68C8BB9402E1a'),
  facilitatorFeeBps: 0, version: '1.3.0'
};
module.exports = { ROBINHOOD_CHAIN_CONFIG, safeAddress };

