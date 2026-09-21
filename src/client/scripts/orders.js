'use strict';
// Backend adapter for the ORIGINAL payment console. No new markup or styles.
const durableConsole = { reference: null, order: null, busy: false, attached: false };
const originalPaymentHandler = handleBrowserPayment;
const orderToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
function orderReferences() { try { return JSON.parse(localStorage.getItem('olanas-orders-v2') || '[]'); } catch (_) { return []; } }
function rememberConsoleOrder(reference) {
  localStorage.setItem('olanas-orders-v2', JSON.stringify([reference, ...orderReferences().filter(r => r.id !== reference.id)].slice(0, 100)));
}
async function consoleOrderApi(suffix = '', body) {
  const ref = durableConsole.reference;
  const response = await fetch('/api/orders' + (ref.id ? '/' + ref.id : '') + suffix, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { authorization: 'Bearer ' + ref.token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Order request failed');
  return data;
}
function renderConsoleOrder(order) {
  durableConsole.order = order;
  document.getElementById('paymentQuotePrice').textContent = order.quote.displayAmount + ' ' + order.quote.token;
  document.getElementById('paymentQuoteToken').textContent = order.quote.network;
  document.getElementById('paymentQuoteRecipient').textContent = order.quote.recipient;
  paymentSetStatus([order.approvalStatus, order.paymentStatus, order.deliveryStatus].join(' · '), 'review');
  paymentSetStep('quote', 'done');
  paymentSetStep('approve', order.approvalStatus === 'approved' ? 'done' : 'working');
  paymentSetStep('verify', order.deliveryStatus === 'completed' ? 'done' : 'working');
  const context = { orderId: order.id, requestId: order.requestId, method: order.method, path: '/x402/' + order.slug + (order.path || ''),
    body: order.body, price: order.quote.displayAmount, token: order.quote.token, recipient: order.quote.recipient,
    approval: order.approvalStatus, payment: order.paymentStatus, delivery: order.deliveryStatus, transaction: order.txHash };
  if (order.result) {
    const text = new TextDecoder().decode(Uint8Array.from(atob(order.result.body), c => c.charCodeAt(0)));
    paymentShowResult(text, 'HTTP ' + order.result.status + ' · Saved result · ' + order.id);
    paymentButton('View saved result');
    paymentRecordHistory({ serviceName: order.quote.name, slug: order.slug, amount: order.quote.displayAmount, token: order.quote.token,
      txHash: order.txHash, receiptId: order.receipt?.receiptId || '', status: 'HTTP ' + order.result.status,
      ok: order.result.status >= 200 && order.result.status < 400, createdAt: new Date(order.createdAt).toISOString() });
  } else {
    paymentShowResult(context, order.deliveryStatus === 'unknown' ? 'Delivery is uncertain. Do not pay again; contact the service creator.' : 'Review this exact request. Quote expires: ' + new Date(order.quote.expiresAt).toLocaleString());
    paymentButton(order.approvalStatus === 'expired' ? 'Refresh quote' : order.approvalStatus === 'rejected' ? 'Reopen for review' :
      order.paymentStatus === 'submitted' ? 'Check original payment' : order.approvalStatus === 'approved' ? 'Recover original payment' : 'Approve ' + order.quote.displayAmount + ' ' + order.quote.token + ' in wallet');
    if (['unknown', 'executing'].includes(order.deliveryStatus)) paymentButton('Check delivery status');
  }
  const secondary = document.getElementById('btnRetryPayment');
  secondary.hidden = !['pending', 'expired'].includes(order.approvalStatus);
  secondary.textContent = 'Reject request';
}
async function openConsoleOrder(id) {
  try {
    const token = window.location.hash.slice(1) || orderReferences().find(r => r.id === id)?.token;
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Open the complete approval link supplied by your agent.');
    durableConsole.reference = { id, token }; durableConsole.attached = true;
    rememberConsoleOrder(durableConsole.reference);
    history.replaceState(null, '', window.location.pathname);
    await loadPaymentServices();
    const order = await consoleOrderApi();
    const select = document.getElementById('paymentService');
    if (!paymentConsoleState.services.some(s => s.slug === order.slug)) {
      const option = document.createElement('option'); option.value = order.slug; option.textContent = order.quote.name; select.append(option);
    }
    select.value = order.slug;
    const method = document.getElementById('paymentMethod');
    method.replaceChildren(); const option = document.createElement('option'); option.value = order.method; option.textContent = order.method; method.append(option);
    document.getElementById('paymentPath').value = order.path || '';
    document.getElementById('paymentBody').value = JSON.stringify(order.body, null, 2);
    for (const name of ['paymentService', 'paymentMethod', 'paymentPath', 'paymentBody']) document.getElementById(name).disabled = true;
    renderConsoleOrder(order);
  } catch (error) { paymentShowResult(error.message); paymentButton('Order unavailable', true); }
}
window.openConsoleOrder = openConsoleOrder;
window.resetConsoleOrder = function() {
  if (!durableConsole.attached || durableConsole.busy) return;
  durableConsole.attached = false; durableConsole.reference = null; durableConsole.order = null;
  for (const name of ['paymentService', 'paymentMethod', 'paymentPath', 'paymentBody']) document.getElementById(name).disabled = false;
  document.getElementById('btnRetryPayment').textContent = 'Retry verification with the same payment';
  updatePaymentSelection();
};

handleBrowserPayment = async function(event) {
  event?.preventDefault();
  const rejectRequested = event?.currentTarget?.id === 'btnRetryPayment';
  if (durableConsole.busy) return;
  // Already submitted legacy transactions keep their original recovery path.
  if (paymentConsoleState.pending && !durableConsole.attached) return originalPaymentHandler(event);
  durableConsole.busy = true;
  paymentButton('Checking order...', true);
  try {
    if (!durableConsole.attached) {
      const request = paymentRequestFromForm();
      const input = { slug: request.service.slug, method: request.method, path: request.path, body: request.body ?? null };
      let draft;
      try { draft = JSON.parse(localStorage.getItem('olanas-order-draft') || 'null'); } catch (_) {}
      if (!draft || JSON.stringify(draft.input) !== JSON.stringify(input)) draft = { input, token: orderToken(), requestId: crypto.randomUUID() };
      localStorage.setItem('olanas-order-draft', JSON.stringify(draft));
      durableConsole.reference = { token: draft.token };
      const order = await consoleOrderApi('', { ...input, requestId: draft.requestId });
      durableConsole.reference.id = order.id; rememberConsoleOrder(durableConsole.reference);
      localStorage.removeItem('olanas-order-draft');
      window.location.href = '/orders/' + order.id + '#' + draft.token;
      return;
    }
    let order = await consoleOrderApi();
    if (rejectRequested && ['pending', 'expired'].includes(order.approvalStatus)) {
      if (confirm('Reject this unpaid request? Repeating its ID will preserve that decision.')) order = await consoleOrderApi('/reject', {});
    } else if (order.approvalStatus === 'expired' || order.approvalStatus === 'rejected') {
      if (order.approvalStatus !== 'rejected' || confirm('Reopen this request for review? No payment will be sent.')) order = await consoleOrderApi(order.approvalStatus === 'expired' ? '/refresh' : '/reopen', {});
    } else if (order.paymentStatus === 'submitted') {
      order = await consoleOrderApi('/reconcile', {});
    } else if (order.deliveryStatus === 'not_started' && order.approvalStatus === 'approved') {
      const known = localStorage.getItem('olanas-order-tx-' + order.id) || '';
      const txHash = prompt('Recover the ORIGINAL transaction hash from your wallet. Leave empty only if you checked wallet activity and no transfer was sent.', known);
      if (txHash?.trim()) { await consoleOrderApi('/payment', { txHash: txHash.trim() }); order = await consoleOrderApi('/reconcile', {}); }
      else if (txHash === '' && confirm('Confirm that you checked your wallet and NO transfer was sent. Cancel this unpaid approval?')) {
        const provider = await serviceSigningProvider();
        if (!provider) throw new Error('Connect the wallet that originally approved this order.');
        const challenge = await consoleOrderApi('/cancellation-message', {});
        const signature = await window.OlanasOrderWallet.sign(provider, challenge.message);
        order = await consoleOrderApi('/cancel-approval', { signature, revision: challenge.revision });
      }
    } else if (order.approvalStatus === 'pending') {
      // Never approve freshly changed terms on the click intended for an old quote.
      if (!durableConsole.order || order.quote.version !== durableConsole.order.quote.version) { renderConsoleOrder(order); return; }
      let provider = await serviceSigningProvider();
      if (!provider) { await triggerPrivyLogin(); provider = await serviceSigningProvider(); }
      if (!provider || !await ensureRobinhoodNetwork(provider)) throw new Error('Connect your wallet on the quoted network.');
      await window.OlanasOrderWallet.pay({ order, provider,
        mutate: (action, body = {}) => consoleOrderApi('/' + action, body),
        saveHash: hash => localStorage.setItem('olanas-order-tx-' + order.id, hash) });
      order = await consoleOrderApi();
    }
    renderConsoleOrder(order);
  } catch (error) {
    if (durableConsole.attached) { try { renderConsoleOrder(await consoleOrderApi()); } catch (_) {} }
    else paymentButton('Review payment');
    paymentShowResult(error.shortMessage || error.message, 'Use this same order for recovery. Do not send another payment.');
  } finally { durableConsole.busy = false; }
};
