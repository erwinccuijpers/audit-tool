import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Detects the dominant natural language of an owner's answer so the interview
// can speak their language from the first reply and follow mid-interview
// switches. Cheap Haiku call; returns the English name of the language, or
// null when the text is too short/ambiguous to judge (so we keep the current
// language rather than flip-flopping on "ja" / "yes" / a bare number).
export async function POST(req: NextRequest) {
  const { text }: { text: string } = await req.json()

  // Too little linguistic content to detect reliably — keep current language.
  if (!text || text.trim().length < 8) {
    return NextResponse.json({ language: null })
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      system: `You detect the dominant natural language of a short text written by a business owner answering interview questions.

Reply with ONLY the English name of the dominant language, capitalized — e.g. "English", "Dutch", "Spanish", "German", "French".

Rules:
- Judge the DOMINANT language. A few borrowed words, brand/tool names, or numbers do NOT change it (e.g. "We gebruiken Shopify en Mailchimp" is Dutch).
- If the text is too short, ambiguous, or just a number / name / yes-no with no real linguistic content, reply exactly "UNKNOWN".
- Output the language name or "UNKNOWN". Nothing else.`,
      messages: [{ role: 'user', content: text.slice(0, 1000) }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const cleaned = raw.replace(/[^a-zA-Z\s]/g, '').trim()
    const language = !cleaned || /^unknown$/i.test(cleaned) ? null : cleaned
    return NextResponse.json({ language, usage: response.usage })
  } catch {
    return NextResponse.json({ language: null })
  }
}
