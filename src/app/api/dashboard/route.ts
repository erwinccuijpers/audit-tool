import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type Summary = { question: string; summary: string }
type CategoryData = { name: string; covered: Summary[]; uncovered: string[] }

export async function POST(req: NextRequest) {
  const { businessName, businessType, industry, businessDescription, ownerTone, categoryData } = await req.json()

  if (!categoryData || categoryData.length === 0) {
    return NextResponse.json({ categories: [] })
  }

  const coveredSection = (categoryData as CategoryData[])
    .filter(c => c.covered.length > 0)
    .map(c =>
      `### ${c.name}\n${c.covered.map(cv => `  • Q: ${cv.question}\n    Owner: ${cv.summary}`).join('\n')}`
    )
    .join('\n\n')

  const uncoveredList = (categoryData as CategoryData[])
    .filter(c => c.covered.length === 0)
    .map(c => `- ${c.name}`)
    .join('\n')

  const allCategories = (categoryData as CategoryData[]).map(c => c.name)

  const prompt = `You are analyzing a business diagnostic interview in progress. Produce honest, data-grounded insights for each category.

BUSINESS CONTEXT:
- Name: ${businessName || 'Unknown'}
- Type: ${businessType || 'Unknown'} (${industry || 'unknown industry'})
- Description: ${businessDescription || 'Not yet described'}
- Owner tone: ${ownerTone || 'unknown'}

WHAT HAS BEEN DISCUSSED:
${coveredSection || 'Nothing covered yet.'}

AREAS NOT YET COVERED:
${uncoveredList || 'All areas covered.'}

Analyze each of these ${allCategories.length} categories:
${allCategories.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each, return a JSON object with:
- "category": exact name from the list above
- "confidence": integer 0–100
    0–25 = no meaningful data from owner
    26–50 = surface answers, gut feel, no specific data
    51–75 = concrete specifics, some numbers or tool names
    76–100 = strong data: metrics cited, tools actually reviewed, specific figures
- "confidence_label": one of "No data" | "Early signals" | "Good basis" | "Strong data"
- "situation": 1–2 sentences on current state. If confidence < 30 write exactly: "Not enough data to assess yet."
- "recommendation": If confidence > 50: direct actionable recommendation. If confidence ≤ 50: start with "More data needed:" then list what's missing.
- "data_gaps": string array of specific missing data points. Empty array if confidence ≥ 76.

CRITICAL: Never invent insights. Low-confidence = honest "need more data" response. A truthful assessment beats a polished guess.

Return ONLY a valid JSON array. No markdown, no preamble.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]'

  let categories
  try {
    categories = JSON.parse(raw)
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    try { categories = match ? JSON.parse(match[0]) : [] } catch { categories = [] }
  }

  return NextResponse.json({ categories })
}
