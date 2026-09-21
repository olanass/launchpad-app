import { Contract, parseUnits } from 'ethers';

// Isolated browser payment orchestration. The caller supplies an already
// connected wallet and the order-scoped API; neither this module nor the API
// stores a signing key. The server must claim approval before any transfer.
export async function executeOrderPayment({ order, provider, signer, mutate, saveHash,
  contractFactory = (address, abi, runner) => new Contract(address, abi, runner) }) {
  const q = order.quote;
  if (order.approvalStatus !== 'pending' || order.paymentStatus !== 'unpaid') throw new Error('This order is not awaiting a new payment. Recover its original transaction.');
  if (parseUnits(q.displayAmount, q.decimals) !== BigInt(q.amount) || BigInt(q.amount) <= 0n) throw new Error('Invalid quote amount.');
  const payer = await signer.getAddress();
  if (Number((await provider.getNetwork()).chainId) !== q.chainId) throw new Error('Wrong payment network.');
  const token = q.asset ? contractFactory(q.asset, [
    'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)',
    'function transfer(address,uint256) returns(bool)'
  ], signer) : null;
  if (token) {
    if (await provider.getCode(q.asset) === '0x') throw new Error('The quoted token contract is not deployed on this network.');
    if (Number(await token.decimals()) !== q.decimals) throw new Error('Token decimals do not match the quote. Payment stopped.');
  }
  const nativeBalance = await provider.getBalance(payer);
  const balance = token ? await token.balanceOf(payer) : nativeBalance;
  if (balance < BigInt(q.amount)) throw new Error('Insufficient ' + q.token + ' balance. Fund your wallet before approving.');
  if (nativeBalance === 0n) throw new Error('Your wallet needs ETH for network fees.');
  const approval = await mutate('approval-message', { payer });
  if (approval.quoteVersion !== q.version) throw new Error('Quote changed. Reload and review its new terms.');
  const signature = await signer.signMessage(approval.message);
  await mutate('approve', { payer, signature, quoteVersion: q.version });
  if (Number((await provider.getNetwork()).chainId) !== q.chainId || await signer.getAddress() !== payer) throw new Error('Wallet or network changed. Review wallet activity before cancelling this unpaid approval.');
  const transaction = token ? await token.transfer(q.recipient, BigInt(q.amount), { chainId: q.chainId }) : await signer.sendTransaction({ to: q.recipient, value: BigInt(q.amount), chainId: q.chainId });
  // Persist first, so a network failure cannot erase the recovery hash.
  await saveHash(transaction.hash);
  await mutate('payment', { txHash: transaction.hash });
  await mutate('reconcile');
  return transaction.hash;
}
