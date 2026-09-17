// Legacy unauthenticated wallet creation is deliberately unavailable.
async function unavailable() {
  throw new Error('Use the authenticated Privy browser SDK to create an owned embedded wallet');
}
module.exports = { getOrCreateEmailWallet: unavailable, createEmbeddedWallet: unavailable };

