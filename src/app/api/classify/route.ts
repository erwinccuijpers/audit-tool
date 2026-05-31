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
  "has_employees": true or false — true if the business clearly has staff, team members, or employees beyond just the owner; false if they appear to run it solo or haven't mentioned any staff,
  "skip_questions": ["list of question IDs from this set that are clearly irrelevant based on what was said: q21, q22, t3, t4, t6"],
  "emphasis_areas": ["list of category names that seem most relevant based on what was said, from: positioning, acquisition, retention, revenue, strategy, tools, people"]
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

  const country = req.headers.get('x-vercel-ip-country') || null
  const city = req.headers.get('x-vercel-ip-city')
    ? decodeURIComponent(req.headers.get('x-vercel-ip-city')!)
    : null

  try {
    const profile = JSON.parse(text)
    return NextResponse.json({ profile, usage: response.usage, country, city })
  } catch {
    return NextResponse.json({ error: 'Failed to parse profile', raw: text }, { status: 500 })
  }
}