import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const ADMIN_EMAIL = 'erwinccuijpers@gmail.com'

type Session = {
  id: string
  business_name: string
  business_type: string
  industry: string
  business_description: string
  owner_tone: string
  status: string
  current_q_index: number
  completed_summaries: { question: string; summary: string }[]
  created_at: string
}

function formatSessionsForClaude(sessions: Session[]) {
  return sessions
    .filter(s => (s.completed_summaries || []).length > 0)
    .map(s =>
      `=== ${s.business_name} (${s.business_type || '?'}, ${s.industry || '?'}) — ${s.completed_summaries.length} topics covered ===\n` +
      s.completed_summaries.map(cs => `• ${cs.question}\n  → ${cs.summary}`).join('\n')
    )
    .join('\n\n')
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, sessions, sessionId, question, history, adminEmail } = body

  if (adminEmail !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── PATTERNS: aggregate analysis across all clients ──────────────────────
  if (action === 'patterns') {
    const relevant = (sessions as Session[]).filter(s => (s.completed_summaries || []).length > 0)
    if (relevant.length === 0) {
      return NextResponse.json({ error: 'No interview data yet.' }, { status: 400 })
    }

    const dataBlock = formatSessionsForClaude(sessions)

    const prompt = `You are analyzing data from ${relevant.length} Pocket CMO business diagnostic interviews. Each business owner answered questions about their operations, marketing, sales, retention, tools, and strategy.

CLIENT DATA:
${dataBlock}

Analyze this data and return a JSON object with exactly these keys:

"top_pain_points": array of objects {issue: string, count: number, examples: string[]} — the most frequently occurring specific problems across businesses, ranked by frequency

"behavioral_patterns": array of objects {pattern: string, description: string, examples: string[]} — recurring owner mindset or behavior patterns. Look for: ego, denial, perfectionism, reactive vs proactive, flying blind, overcomplicating, undervaluing, imposter syndrome, fear of selling, attachment to broken systems, etc.

"knowledge_gaps": array of objects {area: string, frequency: number, description: string} — most common areas where owners have no data and are running on gut feel only

"quick_wins": array of objects {opportunity: string, applicable_to: string, effort: "low"|"medium"|"high", impact: "low"|"medium"|"high"} — recurring fixable issues that could become products, automations, or content

"meta_observation": string — one direct paragraph summarizing what these clients have in common and what it reveals about this client base as a whole

Return ONLY valid JSON. No markdown, no preamble.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
    let result
    try {
      result = JSON.parse(raw)
    } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      try { result = match ? JSON.parse(match[0]) : {} } catch { result = {} }
    }
    return NextResponse.json({ result })
  }

  // ── CLIENT: individual client deep-dive ──────────────────────────────────
  if (action === 'client') {
    const session = (sessions as Session[]).find(s => s.id === sessionId)
    if (!session || !session.completed_summaries?.length) {
      return NextResponse.json({ error: 'No data for this client.' }, { status: 400 })
    }

    const summaryBlock = session.completed_summaries
      .map(cs => `Q: ${cs.question}\n→ ${cs.summary}`)
      .join('\n\n')

    const prompt = `You are doing a deep psychological and strategic analysis of a single business owner based on their diagnostic interview.

BUSINESS: ${session.business_name} (${session.business_type || 'unknown type'}, ${session.industry || 'unknown industry'})
DESCRIPTION: ${session.business_description || 'Not available'}
OWNER TONE: ${session.owner_tone || 'not assessed'}

INTERVIEW DATA:
${summaryBlock}

Analyze this owner and their business. Return JSON with exactly these keys:

"top_challenges": string[] — their 3 most pressing specific business challenges (concrete, not generic)

"mindset_observations": array of {observation: string, evidence: string} — patterns in how this owner thinks. What's getting in their way? What are their strengths? Look for: ego, blind spots, avoidance, fear, perfectionism, magical thinking, underconfidence, overconfidence, rigidity, etc. Be honest and direct — this is for the coach, not the client.

"biggest_opportunity": string — the single highest-leverage thing they're either missing or avoiding

"red_flags": string[] — things that need attention now, including risks they may be downplaying

"next_conversation_topics": string[] — the most valuable areas to dig into in the next session

Return ONLY valid JSON. No markdown.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
    let result
    try {
      result = JSON.parse(raw)
    } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      try { result = match ? JSON.parse(match[0]) : {} } catch { result = {} }
    }
    return NextResponse.json({ result })
  }

  // ── CHAT: ask anything about client data ─────────────────────────────────
  if (action === 'chat') {
    const dataBlock = formatSessionsForClaude(sessions)
    const chatHistory = (history || []) as { role: string; content: string }[]

    const systemPrompt = `You are Erwin's personal business intelligence assistant for Pocket CMO. You have access to data from all his clients. Answer his questions analytically, citing specific businesses by name when relevant. Be direct, specific, and honest — this is internal analysis, not client-facing. If you spot patterns or connections Erwin hasn't asked about, flag them.

CLIENT DATABASE (${(sessions as Session[]).length} total sessions, ${(sessions as Session[]).filter(s => (s.completed_summaries || []).length > 0).length} with interview data):
${dataBlock || 'No interview data collected yet.'}`

    const messages = [
      ...chatHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: question },
    ]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    })

    const message = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ message })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
