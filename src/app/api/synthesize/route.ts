import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse, after } from 'next/server'
import { computeCostUSD } from '@/lib/pricing'

// Synthesis generates up to 8000 tokens in one pass over the full transcript and
// can run 60-150s. Give it real headroom (Vercel Pro allows up to 300s) so the
// function is never killed mid-generation — the default ~15s cap was the root
// cause of reports that "never loaded".
export const maxDuration = 300

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']
const PILLAR_LABELS: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

type PillarInput = { name: string; label: string; conversation: { role: string; content: string }[] }

// End-of-interview synthesis. Unlike the incremental per-pillar summaries written
// during the interview (which are lossy and can silently fall back to stubs on a
// failed call), this runs ONCE over the FULL transcript and produces both the
// final report AND a fresh deep-dive for every pillar — so they're cross-aware
// (e.g. People knows about staff surfaced in Acquisition) and nothing is blank.
//
// It also PERSISTS the result server-side (report + scores + firmographics +
// refreshed pillars + usage). That's deliberate: the client used to do the write
// after a long-held fetch, so a dropped connection (a mobile tab backgrounded
// mid-wait) lost the report. Now the route owns the write and the client just
// polls the DB for it. Takes only `{ sessionId }` — it reads everything else.
export async function POST(req: NextRequest) {
  const { sessionId, force } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
  if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  if (session.status !== 'interview_done' && session.status !== 'completed') {
    return NextResponse.json({ error: "This interview isn't complete yet." }, { status: 409 })
  }

  // Idempotent: a report already exists → serve it. Stops a refresh or a
  // double-fire from re-spending on a fresh synthesis.
  if (session.report && !force) {
    return NextResponse.json({ report: session.report, pillars: session.dashboard_cache?.pillars || {} })
  }

  const businessName = session.business_name || ''
  const lang = session.language || 'English'
  const hasEmployees = session.has_employees

  const pillarsObj: Record<string, any> = session.dashboard_cache?.pillars || {}
  const pillarInputs: PillarInput[] = PILLAR_ORDER
    .filter(p => pillarsObj[p])
    .map(p => ({
      name: p,
      label: PILLAR_LABELS[p] || p,
      conversation: pillarsObj[p].conversation || [
        { role: 'assistant', content: pillarsObj[p].contextSummary || '' },
      ],
    }))
  if (pillarInputs.length === 0) {
    return NextResponse.json({ error: 'No interview data found for this session.' }, { status: 422 })
  }

  const transcript = pillarInputs.map(p => {
    const lines = (p.conversation || [])
      .map(m => `${m.role === 'user' ? 'Owner' : 'Consultant'}: ${m.content}`)
      .join('\n')
    return `### ${p.label.toUpperCase()} ###\n${lines}`
  }).join('\n\n')

  const pillarNames = pillarInputs.map(p => p.name)
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
- SURFACE OPERATIONAL / WORKFLOW BOTTLENECKS the owner treats as normal. If the transcript shows how the work physically gets delivered — kitchen/workspace layout, storage forcing repeated trips, an over-broad offer or menu, things that can't be done in parallel, work coming out in waves under load, or trade-offs made when something goes wrong mid-service — name it as a concrete observation even though the owner did not frame it as a problem. These "it's just how it's always been" constraints are usually invisible to the owner and are often the real ceiling on quality and growth, so they belong in the Strategy area insight and, where actionable, in quickWins or bigBets (e.g. narrowing the menu, splitting lunch/dinner, reorganising prep or storage).

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

  const generated = parsed.report
  const refreshedPillars: Record<string, any> = parsed.pillars || {}

  // ── Persist server-side (so a dropped client connection can't lose it) ──
  const scoreMap: Record<string, number> = {}
  if (generated.areas?.length > 0) generated.areas.forEach((a: any) => { scoreMap[a.category] = a.score })

  const f = generated.firmographics || {}
  const firmoPatch: Record<string, any> = {}
  if (f.niche != null) firmoPatch.niche = f.niche
  if (typeof f.employee_count === 'number') firmoPatch.employee_count = f.employee_count
  if (f.size_band != null) firmoPatch.size_band = f.size_band
  if (f.revenue_band != null) firmoPatch.revenue_band = f.revenue_band
  if (typeof f.years_in_business === 'number') firmoPatch.years_in_business = f.years_in_business
  if (f.region != null) firmoPatch.region = f.region

  // Fold the synthesis' refreshed deep-dives back into dashboard_cache, overwriting
  // the incremental (possibly stubbed) situation / recommendation / entities while
  // preserving each pillar's raw conversation + metadata.
  const mergedPillars: Record<string, any> = { ...pillarsObj }
  for (const [name, d] of Object.entries(refreshedPillars)) {
    if (!mergedPillars[name]) continue
    const rd = d as any
    mergedPillars[name] = {
      ...mergedPillars[name],
      situation: rd.situation ?? mergedPillars[name].situation,
      recommendation: rd.recommendation ?? mergedPillars[name].recommendation,
      confidence: typeof rd.confidence === 'number' ? rd.confidence : mergedPillars[name].confidence,
      entities: rd.entities ?? mergedPillars[name].entities,
      dataGaps: rd.dataGaps ?? mergedPillars[name].dataGaps,
    }
  }

  // Fold this generation's tokens into the session's running totals + cost.
  const u = response.usage
  const input = (session.input_tokens ?? 0) + (u?.input_tokens ?? 0)
  const output = (session.output_tokens ?? 0) + (u?.output_tokens ?? 0)

  await supabase.from('sessions').update({
    status: 'completed',
    scores: Object.keys(scoreMap).length > 0 ? scoreMap : null,
    report: generated,
    ...firmoPatch,
    dashboard_cache: { v: 2, pillars: mergedPillars },
    input_tokens: input,
    output_tokens: output,
    cost_usd: computeCostUSD(input, output),
  }).eq('id', sessionId)

  // Pattern-match (admin analytics) — fire after the response, non-blocking.
  const origin = new URL(req.url).origin
  after(async () => {
    try {
      await fetch(`${origin}/api/pattern-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch { /* non-critical */ }
  })

  return NextResponse.json({ report: generated, pillars: mergedPillars })
}
