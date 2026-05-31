import { supabase } from './supabase'
import { computeCostUSD } from './pricing'

type Usage = { input_tokens?: number; output_tokens?: number } | null | undefined

// Adds Anthropic token usage to a session's running totals and recomputes the
// stored estimated cost. Called at interview completion (with the accumulated
// interview-phase total) and again when the report generates. Read-modify-write
// is fine here — there's only ever one writer per session at a time.
export async function addSessionUsage(sessionId: string | null | undefined, usage: Usage) {
  if (!usage || !sessionId) return
  const inc_in = usage.input_tokens ?? 0
  const inc_out = usage.output_tokens ?? 0
  if (inc_in === 0 && inc_out === 0) return

  const { data } = await supabase
    .from('sessions')
    .select('input_tokens, output_tokens')
    .eq('id', sessionId)
    .single()

  const input = (data?.input_tokens ?? 0) + inc_in
  const output = (data?.output_tokens ?? 0) + inc_out

  await supabase.from('sessions').update({
    input_tokens: input,
    output_tokens: output,
    cost_usd: computeCostUSD(input, output),
  }).eq('id', sessionId)
}
