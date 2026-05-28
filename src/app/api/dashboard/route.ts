import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: questions } = await supabase
    .from('questions')
    .select('id, category, core_question, applies_to')
    .order('sort_order')

  if (!questions) return NextResponse.json({ error: 'No questions' }, { status: 500 })

  const businessType = session.business_type || 'all'
  const filtered = questions.filter((q: any) => {
    if (!q.applies_to || q.applies_to.length === 0) return true
    return q.applies_to.includes(businessType) || q.applies_to.includes('all')
  })

  // Build ordered unique category list
  const categoryOrder: string[] = []
  const categoryQuestions = new Map<string, string[]>()
  filtered.forEach((q: any) => {
    if (!q.category) return
    if (!categoryQuestions.has(q.category)) {
      categoryQuestions.set(q.category, [])
      categoryOrder.push(q.category)
    }
    categoryQuestions.get(q.category)!.push(q.core_question)
  })

  const completedSummaries: { question: string; summary: string }[] = session.completed_summaries || []
  const summaryMap = new Map(completedSummaries.map(s => [s.question, s.summary]))

  // Build per-category coverage blocks
  const coverageBlocks = categoryOrder.map(cat => {
    const qs = categoryQuestions.get(cat) || []
    const covered = qs
      .filter(q => summaryMap.has(q))
      .map(q => `  • Q: ${q}\n    Owner: ${summaryMap.get(q)}`)
    const uncovered = qs.filter(q => !summaryMap.has(q))
    return { cat, covered, uncovered }
  })

  const coveredSection = coverageBlocks
    .filter(b => b.covered.length > 0)
    .map(b => `### ${b.cat}\n${b.covered.join('\n')}`)
    .join('\n\n')

  const uncoveredList = coverageBlocks
    .filter(b => b.covered.length === 0)
    .map(b => `- ${b.cat}`)
    .join('\n')

  const prompt = `You are analyzing a business diagnostic interview that is currently in progress. Produce honest, data-grounded insights for each category.

BUSINESS CONTEXT:
- Name: ${session.business_name}
- Type: ${session.business_type || 'Unknown'} (${session.industry || 'unknown industry'})
- Description: ${session.business_description || 'Not yet described'}
- Owner tone: ${session.owner_tone || 'unknown'}

WHAT HAS BEEN DISCUSSED:
${coveredSection || 'Nothing covered yet.'}

AREAS NOT YET COVERED:
${uncoveredList || 'All areas covered.'}

Analyze each of these ${categoryOrder.length} categories:
${categoryOrder.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each, return a JSON object with:
- "category": exact name from the list above
- "confidence": integer 0–100
    0–25 = no meaningful data from owner
    26–50 = surface answers, gut feel, no specific data
    51–75 = concrete specifics, some numbers or tool names
    76–100 = strong data: metrics cited, tools actually reviewed, specific figures
- "confidence_label": one of "No data" | "Early signals" | "Good basis" | "Strong data"
- "situation": 1–2 sentences on current state. If confidence < 30 write exactly: "Not enough data to assess yet."
- "recommendation": If confidence > 50: direct actionable recommendation. If confidence ≤ 50: start with "More data needed:" then list what's missing.
- "data_gaps": string array of specific missing data points. Empty array if confidence ≥ 76.

CRITICAL: Never invent insights. Low-confidence = honest "need more data" response. A truthful assessment beats a polished guess.

Return ONLY a valid JSON array. No markdown, no preamble.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]'

  let categories
  try {
    categories = JSON.parse(raw)
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    try { categories = match ? JSON.parse(match[0]) : [] } catch { categories = [] }
  }

  return NextResponse.json({ categories, businessName: session.business_name })
}
