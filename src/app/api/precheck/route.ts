import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  const { question, context, businessProfile } = await req.json()

  const contextBlock = context
    .map((p: any, i: number) => `${i + 1}. Q: ${p.question}\n   A: ${p.summary}`)
    .join('\n')

  const prompt = `You are deciding whether to skip an interview question because it has already been clearly answered.

BUSINESS TYPE: ${businessProfile?.business_type || 'unknown'} (${businessProfile?.industry || 'unknown'})

WHAT HAS ALREADY BEEN ESTABLISHED:
${contextBlock}

QUESTION BEING CONSIDERED: "${question}"

Answer with a single JSON object:
{
  "covered": true or false,
  "reason": "one sentence explanation"
}

Return true if:
- The answer to this question is already obvious from what was said
- Asking it would feel repetitive or insulting to the owner
- The business context makes it clearly irrelevant (e.g. asking a beach stall about reactivation campaigns)

Return false if:
- There is still something genuinely new to learn
- The question covers a different angle not yet touched on

Return only the JSON, no markdown.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'

  try {
    const result = JSON.parse(text)
    return NextResponse.json({ covered: result.covered === true })
  } catch {
    return NextResponse.json({ covered: false })
  }
}