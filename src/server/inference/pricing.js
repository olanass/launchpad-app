'use strict';

function costMicros(usage, pricing) {
  const input = Number(usage?.prompt_tokens);
  const output = Number(usage?.completion_tokens);
  const prompt = Number(pricing?.prompt);
  const completion = Number(pricing?.completion);
  if (![input, output, prompt, completion].every(Number.isFinite) || input < 0 || output < 0 || prompt < 0 || completion < 0) throw new Error('Model usage or pricing is unavailable');
  return Math.ceil((input * prompt + output * completion) * 1e6);
}

module.exports = { costMicros };
