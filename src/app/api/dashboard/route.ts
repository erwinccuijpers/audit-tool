import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type Summary = { question: string; summary: string; data_backed?: boolean | null }
type CategoryData = { name: string; covered: Summary[]; uncovered: string[] }
type CachedSituation = { category: string; situation: string }

export async function POST(req: NextRequest) {
  const {
    businessName, businessType, industry, businessDescription, ownerTone,
    categoryData, language,
    categoriesToRegenerate,  // string[] | undefined — if set, only generate these categories
    cachedSituations,        // CachedSituation[] | undefined — existing summaries for emerging_picture context
  } = await req.json()
  const lang = language || 'English'

  if (!categoryData || categoryData.length === 0) {
    return NextResponse.json({ categories: [], emerging_picture: null })
  }

  // When doing partial regeneration, filter to only stale categories
  const targetData: CategoryData[] = categoriesToRegenerate?.length
    ? (categoryData as CategoryData[]).filter(c => categoriesToRegenerate.includes(c.name))
    : (categoryData as CategoryData[])

  if (targetData.length === 0) {
    return NextResponse.json({ categories: [], emerging_picture: null })
  }

  const coveredSection = targetData
    .filter(c => c.covered.length > 0)
    .map(c =>
      `### ${c.name}\n${c.covered.map(cv => {
        const tag = cv.data_backed === true ? '[DATA-BACKED]' : cv.data_backed === false ? '[GUT FEEL]' : '[UNTAGGED]'
        return `  • Q: ${cv.question}\n    ${tag} Owner: ${cv.summary}`
      }).join('\n')}`
    )
    .join('\n\n')

  const uncoveredList = targetData
    .filter(c => c.covered.length === 0)
    .map(c => `- ${c.name}`)
    .join('\n')

  const targetCategories = targetData.map(c => c.name)

  // Cached context from non-stale categories — used for accurate emerging_picture
  const cachedContext = (cachedSituations as CachedSituation[] | undefined)?.length
    ? `\nALREADY ANALYZED (do NOT re-analyze — use for emerging_picture synthesis only):\n${
        cachedSituations.map((c: CachedSituation) => `- ${c.category}: ${c.situation}`).join('\n')
      }`
    : ''

  const prompt = `You are analyzing a business diagnostic interview in progress. Produce honest, data-grounded insights for each category.

BUSINESS CONTEXT:
- Name: ${businessName || 'Unknown'}
- Type: ${businessType || 'Unknown'} (${industry || 'unknown industry'})
- Description: ${businessDescription || 'Not yet described'}
- Owner tone: ${ownerTone || 'unknown'}
${cachedContext}
WHAT HAS BEEN DISCUSSED (analyze these):
${coveredSection || 'Nothing covered yet.'}

AREAS NOT YET COVERED:
${uncoveredList || 'All areas covered.'}

Analyze ONLY these ${targetCategories.length} categories:
${targetCategories.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each category return a JSON object with:
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

Return a JSON object with exactly two keys:

"emerging_picture": A 2–3 sentence honest read of what is already visible from ALL the data collected (including the already-analyzed categories listed above). Name the 1–2 most significant signals or tensions. Be explicit that the picture is still incomplete and will sharpen as more areas are covered. If fewer than 2 areas have data across all categories, write a single sentence only. If nothing is covered anywhere, return null.

"categories": the array of category objects described above (ONLY the ${targetCategories.length} listed categories).

LANGUAGE: Write all text values in ${lang}. JSON keys must stay in English.

Return ONLY valid JSON. No markdown, no preamble.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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

  const categories = Array.isArray(parsed) ? parsed : (parsed.categories || [])
  const emerging_picture = Array.isArray(parsed) ? null : (parsed.emerging_picture || null)

  return NextResponse.json({ categories, emerging_picture, usage: response.usage })
}
