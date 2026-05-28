import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  const { businessName, responses } = await req.json()

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
  ]
}

Categories to always include: Client Acquisition, Revenue Optimization, Client Retention, Marketing & Visibility, Tools & Systems, Competitive Position

Score honestly — do not inflate scores. If something was not discussed or the owner didn't know the answer, score it 2.

Return only the JSON object, no markdown, no explanation.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
  
  try {
    const report = JSON.parse(text)
    return NextResponse.json({ report })
  } catch {
    return NextResponse.json({ error: 'Failed to parse report', raw: text }, { status: 500 })
  }
}