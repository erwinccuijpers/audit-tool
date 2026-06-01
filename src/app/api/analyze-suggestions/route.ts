import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Clusters the free-text Open Suggestions into themes for a quick read on demand.
export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { mode } = await req.json().catch(() => ({}))
  const isTest = mode === 'demo'

  const { data } = await supabase
    .from('product_interests')
    .select('note, email, created_at')
    .eq('product_key', 'open_suggestions')
    .eq('is_test', isTest)
    .not('note', 'is', null)
    .order('created_at', { ascending: false })

  const notes = (data || []).map(r => r.note).filter(Boolean)
  if (notes.length === 0) {
    return NextResponse.json({ analysis: 'No suggestions submitted yet.', count: 0 })
  }

  const prompt = `These are free-text suggestions submitted by people who used a business-diagnostic tool. Cluster them into themes and give a concise read for the founder.

SUGGESTIONS (${notes.length}):
${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return a short markdown brief with:
- **Themes** — group them (e.g. partnership / work-with-us, white-label / reseller, specific feature requests, pricing, other). For each theme: a count and a one-line summary.
- **Notable asks** — 2–4 standout individual requests worth a direct reply.
- **One-line takeaway** — what this batch is telling the founder to prioritise.
Keep it tight. No preamble.`

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })
    const analysis = resp.content[0].type === 'text' ? resp.content[0].text.trim() : ''
    return NextResponse.json({ analysis, count: notes.length })
  } catch {
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
