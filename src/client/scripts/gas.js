// -------------------------------------------------------------
// 4. REAL-TIME GAS FEE POLLING (ROBINHOOD CHAIN RPC)
// -------------------------------------------------------------
async function initGasPolling() {
  fetchGasEstimate();
  setInterval(fetchGasEstimate, 7000);
}

async function fetchGasEstimate() {
  try {
    const res = await fetch('/api/paywalls/gas-estimate');
    const data = await res.json();
    if (data.success && data.estimate) {
      state.liveGasEstimate = data.estimate;
      renderGasEstimates(data.estimate);
    }
  } catch (err) {
    console.warn('Gas polling fallback:', err);
  }
}

function renderGasEstimates(est) {
  const liveGwei = document.getElementById('liveGasGwei');
  const liveUsd = document.getElementById('liveGasUsd');
  const cardGwei = document.getElementById('cardGasGwei');
  const cardCost = document.getElementById('cardGasEth');

  if (liveGwei) liveGwei.textContent = `${est.gasPriceGwei ?? 'Unavailable'} Gwei`;
  if (liveUsd) liveUsd.textContent = `(${est.formattedUsd})`;
  if (cardGwei) cardGwei.textContent = `${est.gasPriceGwei ?? 'Unavailable'} Gwei`;
  if (cardCost) cardCost.textContent = `${est.totalFeeEth ?? 'Unavailable'} ETH (${est.formattedUsd})`;
}
