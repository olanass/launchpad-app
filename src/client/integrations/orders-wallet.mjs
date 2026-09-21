import { BrowserProvider } from 'ethers';
import { executeOrderPayment } from '../../../app/payment-flow.mjs';
export async function pay({ provider: injected, ...options }) {
  const provider = new BrowserProvider(injected, 'any');
  return executeOrderPayment({ ...options, provider, signer: await provider.getSigner() });
}
export async function sign(injected, message) {
  return (await new BrowserProvider(injected, 'any').getSigner()).signMessage(message);
}
