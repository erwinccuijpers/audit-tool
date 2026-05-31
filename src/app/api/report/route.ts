import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  const { businessName, responses, language } = await req.json()
  const lang = language || 'English'

  const transcript = responses.map((r: any) => {
    const messages = r.conversation
      .map((m: any) => `${m.role === 'user' ? 'Owner' : 'Interviewer'}: ${m.content}`)
      .join('\n')
    return `--- ${r.question} ---\n${messages}`
  }).join('\n\n')

  const prompt = `You are a business diagnostic consultant. You just completed an interview with the owner of "${businessName}".

Here is the full interview transcript:

${transcript}

Based on this, produce a diagnostic report as a JSON object with exactly this structure:

{
  "summary": "2-3 sentence plain-English overview of the business and its situation",
  "areas": [
    {
      "category": "category name",
      "score": <number 1-5, where 1=critical gap, 5=strong>,
      "label": "one-line status label",
      "insight": "1-2 sentences of what you found",
      "opportunity": "1 concrete thing they could do"
    }
  ],
  "quickWins": [
    {
      "title": "action title",
      "desc": "one sentence description",
      "effort": <1-3>,
      "impact": <1-3>
    }
  ],
  "bigBets": [
    {
      "title": "action title",
      "desc": "one sentence description",
      "mvp": "how to validate this manually before building"
    }
  ],
  "firmographics": {
    "niche": "specific sub-category in a few words, e.g. 'specialty wine & cheese retail', 'mobile dog grooming' — more precise than the industry",
    "employee_count": <integer: best estimate of TOTAL people working in the business including the owner, or null if truly unknown>,
    "size_band": "one of: solo / micro / small / medium / large (solo=1, micro=2-9, small=10-49, medium=50-249, large=250+)",
    "revenue_band": "best estimate of annual revenue, one of: under_100k / 100k_250k / 250k_500k / 500k_1m / 1m_5m / 5m_plus / unknown",
    "years_in_business": <integer years since founding, or null if not stated>,
    "region": "state / province / region if identifiable (e.g. 'Connecticut'), else null"
  }
}

For firmographics, infer conservatively from everything the owner said (staff mentioned, transaction values, customer counts, founding year, location). Use the bands; do not invent precise figures. If a value genuinely can't be estimated, use null (or "unknown" for revenue_band).

Categories to always include: Client Acquisition, Revenue Optimization, Client Retention, Marketing & Visibility, Tools & Systems, Competitive Position

Score honestly — do not inflate scores. If something was not discussed or the owner didn't know the answer, score it 2.

LANGUAGE: Write all text values in ${lang}. JSON keys stay in English.

Return only the JSON object, no markdown, no explanation.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
  
  try {
    const report = JSON.parse(text)
    return NextResponse.json({ report, usage: response.usage })
  } catch {
    return NextResponse.json({ error: 'Failed to parse report', raw: text }, { status: 500 })
  }
}