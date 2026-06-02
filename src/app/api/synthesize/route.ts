import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type PillarInput = { name: string; label: string; conversation: { role: string; content: string }[] }

// End-of-interview synthesis. Unlike the incremental per-pillar summaries written
// during the interview (which are lossy and can silently fall back to stubs on a
// failed call), this runs ONCE over the FULL transcript and produces both the
// final report AND a fresh deep-dive for every pillar — so they're cross-aware
// (e.g. People knows about staff surfaced in Acquisition) and nothing is blank.
export async function POST(req: NextRequest) {
  const { businessName, pillars, language, hasEmployees } = await req.json()
  const lang = language || 'English'

  const transcript = (pillars as PillarInput[]).map(p => {
    const lines = (p.conversation || [])
      .map(m => `${m.role === 'user' ? 'Owner' : 'Consultant'}: ${m.content}`)
      .join('\n')
    return `### ${p.label.toUpperCase()} ###\n${lines}`
  }).join('\n\n')

  const pillarNames = (pillars as PillarInput[]).map(p => p.name)
  const staffNote = hasEmployees === false
    ? 'This owner runs the business SOLO (no staff) — assess People as owner-dependency / key-person risk.'
    : hasEmployees === true
      ? 'This owner HAS staff — assess People as team stability, delegation, and key-person risk.'
      : 'Staff status was never made explicit — assess People from whatever the transcript shows (owner-dependency and/or team).'

  const prompt = `You are a business diagnostic consultant. You just completed a full interview with the owner of "${businessName}". Below is the COMPLETE transcript, organised by section.

${transcript}

Using the ENTIRE transcript as one connected picture (a fact stated in one section informs every other section), produce a single JSON object with this exact structure:

{
  "report": {
    "summary": "2-3 sentence plain-English overview of the business and its situation",
    "areas": [
      { "category": "category name", "score": <1-5, 1=critical gap, 5=strong>, "label": "one-line status label", "insight": "1-2 sentences of what you found", "opportunity": "1 concrete thing they could do" }
    ],
    "quickWins": [ { "title": "action title", "desc": "one sentence", "effort": <1-3>, "impact": <1-3> } ],
    "bigBets": [ { "title": "action title", "desc": "one sentence", "mvp": "how to validate this manually before building" } ],
    "firmographics": {
      "niche": "specific sub-category in a few words (more precise than the industry)",
      "employee_count": <integer total people including owner, or null>,
      "size_band": "one of: solo / micro / small / medium / large (solo=1, micro=2-9, small=10-49, medium=50-249, large=250+)",
      "revenue_band": "one of: under_100k / 100k_250k / 250k_500k / 500k_1m / 1m_5m / 5m_plus / unknown",
      "years_in_business": <integer years since founding, or null>,
      "region": "state / province / region if identifiable, else null"
    }
  },
  "pillars": {
    "<pillar name>": {
      "situation": "2-3 sentences on the current state of this area, written for the owner. Honest — if data is thin, say so.",
      "recommendation": "One concrete, specific first action grounded in what they actually said.",
      "confidence": <0-100: how data-backed this area is>,
      "entities": { "tools": [], "numbers": [], "competitors": [], "flags": ["key observations; include deliberate inactions WITH the owner's stated reason, e.g. 'Paused referrals — deliberate, prioritising the warehouse bottleneck'"] },
      "dataGaps": ["specific data that would sharpen this assessment"]
    }
  }
}

REQUIREMENTS:
- "report.areas" must always include all of these categories: Positioning, Acquisition, Retention, Revenue, Strategy, Tools & Systems, People.
- "pillars" must contain an entry for EVERY one of these section names that appears in the transcript: ${pillarNames.join(', ')}. Never leave one blank or generic — every section above has real conversation to draw from.
- ${staffNote}
- Score honestly — do not inflate. If something genuinely wasn't discussed, score it 2.
- Where the owner deliberately deprioritised something (a known issue they chose not to act on because something else mattered more), reflect that judgement: say whether their sequencing looks sound or whether they should switch focus.

LANGUAGE: Write all text values in ${lang}. JSON keys (and pillar names) stay in English.

Return ONLY the JSON object, no markdown, no explanation.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    // Low temperature keeps scoring consistent — without it, regenerating the same
    // transcript can drift (e.g. 2 → 1 → 0 critical gaps) on pure sampling variance.
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
  let parsed: any = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    try { parsed = match ? JSON.parse(match[0]) : {} } catch { parsed = {} }
  }

  if (!parsed.report) {
    return NextResponse.json({ error: 'Failed to parse synthesis', raw: text }, { status: 500 })
  }
  return NextResponse.json({ report: parsed.report, pillars: parsed.pillars || {}, usage: response.usage })
}
