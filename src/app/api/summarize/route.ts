import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const { businessName, completedSummaries, language } = await req.json()
  const lang = language || 'English'

  if (!completedSummaries || completedSummaries.length === 0) {
    return NextResponse.json({ summary: "Nothing covered in depth yet." })
  }

  const covered = completedSummaries.map((s: any) => `- ${s.question}: ${s.summary}`).join('\n')

  const prompt = `You're mid-way through a business diagnostic interview with ${businessName}. Here's what has been covered so far:

${covered}

Write 2-3 sentences summarising the key themes and most important signals that have emerged. Be direct and specific — name actual things that stood out. Address the business owner directly ("We've talked about...", "What's coming through is..."). Keep it under 80 words.

LANGUAGE: Write in ${lang}.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const summary = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  return NextResponse.json({ summary, usage: response.usage })
}
