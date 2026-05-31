import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type Message = { role: 'user' | 'assistant'; content: string }
type PreviousSummary = { contextSummary: string; entities: { tools: string[]; numbers: string[]; competitors: string[]; flags: string[] } }

export async function POST(req: NextRequest) {
  const {
    pillarName,
    pillarLabel,
    pillarConversation,
    previousPillarSummaries,
    businessProfile,
    language,
  }: {
    pillarName: string
    pillarLabel: string
    pillarConversation: Message[]
    previousPillarSummaries: Record<string, PreviousSummary>
    businessProfile: any
    language: string
  } = await req.json()

  const lang = language || 'English'

  const conversationText = pillarConversation
    .map(m => `${m.role === 'assistant' ? 'Consultant' : 'Owner'}: ${m.content}`)
    .join('\n\n')

  const prevContext = Object.entries(previousPillarSummaries)
    .map(([name, s]) => {
      const entityLines = [
        s.entities.tools?.length ? `Tools: ${s.entities.tools.join(', ')}` : '',
        s.entities.numbers?.length ? `Numbers: ${s.entities.numbers.join(', ')}` : '',
        s.entities.competitors?.length ? `Competitors: ${s.entities.competitors.join(', ')}` : '',
        s.entities.flags?.length ? `Flags: ${s.entities.flags.join(' · ')}` : '',
      ].filter(Boolean).join(' | ')
      return `[${name.toUpperCase()}] ${s.contextSummary}${entityLines ? ` (${entityLines})` : ''}`
    })
    .join('\n')

  const profileBlock = businessProfile
    ? `${businessProfile.business_type} (${businessProfile.industry}), ${businessProfile.business_description || ''}`
    : 'Unknown business'

  const prompt = `You just completed the ${pillarLabel} section of a business diagnostic interview.

BUSINESS: ${profileBlock}

${prevContext ? `CONTEXT FROM OTHER SECTIONS:\n${prevContext}\n` : ''}

FULL CONVERSATION FOR ${pillarLabel.toUpperCase()}:
${conversationText}

Generate a structured assessment of this section. Return ONLY valid JSON with exactly these fields:

{
  "contextSummary": "2-3 sentence factual prose. What is true about this area of their business right now. This will be read by the AI consultant for context in later sections — be factual, dense, and specific. No recommendations here.",
  "entities": {
    "tools": ["any software, app, platform, or tool mentioned by name"],
    "numbers": ["any specific figures cited: revenue, client count, percentages, prices, etc."],
    "competitors": ["any named competitors or comparable businesses mentioned"],
    "flags": ["key observations worth tracking: gaps, risks, surprises, or things that need follow-up — in plain language"]
  },
  "confidence": 72,
  "situation": "2-3 sentences on the current state of this area. Honest — if data is thin, say so. Written for the business owner to read.",
  "recommendation": "One concrete, specific first angle or action for this business. Not generic advice — something grounded in what they actually told you.",
  "dataGaps": ["specific piece of data that would sharpen this assessment", "another gap if applicable"]
}

CONFIDENCE SCALE:
0–25: owner had no real data, everything was vague or unknown
26–50: surface answers, gut feel, no specifics
51–75: concrete details, some numbers or tool names, mostly believable
76–100: specific metrics cited, tools named and actually used, figures cross-checked

LANGUAGE: All text values in ${lang}. JSON keys stay in English.

Return ONLY valid JSON. No markdown, no preamble.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'

  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    try { parsed = match ? JSON.parse(match[0]) : {} } catch { parsed = {} }
  }

  return NextResponse.json({ ...parsed, usage: response.usage })
}
