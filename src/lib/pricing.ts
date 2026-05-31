// ── Model pricing ────────────────────────────────────────────────────────────
// USD per 1,000,000 tokens. UPDATE THESE when Anthropic pricing changes or when
// switching models. Current values are for claude-sonnet-4-6 (the model used by
// every interview/report/summary route). If routes start mixing models, split
// this into a per-model map.
export const MODEL_PRICING = {
  model: 'claude-sonnet-4-6',
  inputPerMTok: 3.0,   // $ per 1M input tokens
  outputPerMTok: 15.0, // $ per 1M output tokens
}

// Estimated USD cost for a given token count, rounded to 4 decimals.
export function computeCostUSD(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * MODEL_PRICING.inputPerMTok +
    (outputTokens / 1_000_000) * MODEL_PRICING.outputPerMTok
  return Math.round(cost * 10_000) / 10_000
}
