import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Localizes the interview's fixed scaffolding (openers, transitions, pillar
// questions, welcome lines) into the owner's chosen language so the tool speaks
// one consistent language. The AI-generated content is already produced in-
// language elsewhere; this only covers the hardcoded strings. Haiku — cheap/fast.
export async function POST(req: NextRequest) {
  const { texts, language } = await req.json()
  const lang = (language || 'English').trim()

  if (!Array.isArray(texts) || texts.length === 0) {
    return NextResponse.json({ translations: [] })
  }
  // No-op for English — caller normally skips, but guard anyway.
  if (/^english$/i.test(lang)) {
    return NextResponse.json({ translations: texts, ok: true })
  }

  const numbered = texts.map((t, i) => `[${i}] ${t}`).join('\n\n')
  const glossary = /^dutch$/i.test(lang)
    ? `\n\nDutch glossary (use these, they read naturally to a business owner):
- "gut feeling" → "onderbuikgevoel" (never "gevoelsmens")
- "leaving money on the table" → "geld laten liggen"
- "average transaction value" → "gemiddelde besteding per order"
- "repeat purchase / repeat business" → "herhaalaankopen"
- "retention" → "klantbehoud"
- "quick wins" → "snelle winsten"
- "you mentioned earlier" → "je noemde net / eerder"`
    : ''
  const prompt = `Translate each numbered item below into ${lang}. These are messages a friendly, sharp business consultant says to a business owner during an interview — keep the warm, natural, conversational tone of a smart peer (never literal, robotic, or formal). Use everyday business language a real owner would use, not textbook translations. Preserve line breaks and any em-dashes within an item. Do NOT translate brand names, tool names, or proper nouns.${glossary}

Return ONLY a JSON array of strings in the same order, no keys, no markdown.

${numbered}`

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '[]'
    let arr: string[] = []
    try { arr = JSON.parse(raw) } catch {
      const m = raw.match(/\[[\s\S]*\]/)
      arr = m ? JSON.parse(m[0]) : []
    }
    // Fall back to the original string for any item that didn't come back.
    // ok=false if the model gave us nothing usable, so the client won't cache a
    // fallback (which would otherwise freeze English in for that string).
    const ok = arr.length > 0 && arr.some((s, i) => typeof s === 'string' && s.trim() && s !== texts[i])
    const translations = texts.map((t, i) => (typeof arr[i] === 'string' && arr[i].trim() ? arr[i] : t))
    return NextResponse.json({ translations, ok, usage: resp.usage })
  } catch {
    // On any failure, return originals — better English than a broken interview —
    // but signal ok=false so the client treats it as non-cacheable.
    return NextResponse.json({ translations: texts, ok: false })
  }
}
