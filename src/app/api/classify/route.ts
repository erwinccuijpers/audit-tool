import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  const { conversation, businessName } = await req.json()

  const transcript = conversation
    .map((m: any) => `${m.role === 'user' ? 'Owner' : 'Interviewer'}: ${m.content}`)
    .join('\n')

  const prompt = `You just had this intro conversation with the owner of "${businessName}":

${transcript}

Extract a business profile as JSON with exactly this structure:

{
  "business_description": "2-3 sentence plain description of what this business is in the owner's own words",
  "business_type": "one of: walkin / service / online / b2b",
  "industry": "one word or short phrase, e.g. hospitality, retail, consulting, events, food, beauty",
  "awareness_level": "one of: knows_the_gap / has_a_hunch / no_idea",
  "owner_tone": "one of: confident / stressed / defensive / excited / uncertain",
  "first_name": "owner first name if mentioned, otherwise null",
  "skip_questions": ["list of question IDs from this set that are clearly irrelevant based on what was said: q38, q39, q49, q50, q21, q22, t3, t4, t6"],
  "emphasis_areas": ["list of category names that seem most relevant based on what was said, from: acquisition, retention, revenue, marketing, positioning, tools, leverage, risk"]
}

Business types:
- walkin: physical location where customers come in without booking (cafe, shop, market stall)
- service: appointment or project based (cleaner, consultant, photographer, events)
- online: primarily sells online
- b2b: sells to other businesses

Awareness levels:
- knows_the_gap: they clearly stated a specific problem they know about
- has_a_hunch: they have a feeling something is off but can't pinpoint it
- no_idea: they genuinely don't know where they're leaking value

Return only the JSON object, no markdown, no explanation.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'

  try {
    const profile = JSON.parse(text)
    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ error: 'Failed to parse profile', raw: text }, { status: 500 })
  }
}