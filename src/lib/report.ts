import { supabase } from '@/lib/supabase'
import { addSessionUsage } from '@/lib/usage'

export type AreaScore = { category: string; score: number; label: string; insight: string; opportunity: string }
export type QuickWin = { title: string; desc: string; effort: number; impact: number }
export type BigBet = { title: string; desc: string; mvp: string }
export type Report = { summary: string; areas: AreaScore[]; quickWins: QuickWin[]; bigBets: BigBet[] }

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']
const PILLAR_LABELS: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

type EnsureResult =
  | { report: Report; businessName: string; error?: undefined }
  | { report?: undefined; businessName?: string; error: string }

// Single source of truth for report retrieval/generation, used by both the
// results page and the client hub. Serves the stored report when present;
// only calls Claude when there's nothing stored or when force === true.
export async function ensureReport(sessionId: string, opts: { force?: boolean } = {}): Promise<EnsureResult> {
  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!session) return { error: 'Session not found.' }
  if (session.status !== 'interview_done' && session.status !== 'completed') {
    return { error: 'This interview isn\'t complete yet — go back and finish the conversation first.' }
  }

  const businessName = session.business_name || ''

  if (session.report && !opts.force) {
    return { report: session.report as Report, businessName }
  }

  const isV2 = session.dashboard_cache?.v === 2
  let generated: any
  let genUsage: any
  let refreshedPillars: Record<string, any> | null = null

  if (isV2) {
    // Pillar sessions: run the full-transcript synthesis — one authoritative pass
    // that produces the report AND a fresh deep-dive for every pillar (cross-aware,
    // and immune to the incremental summaries' silent stub fallback).
    const pillarsObj: Record<string, any> = session.dashboard_cache?.pillars || {}
    const pillarInputs = PILLAR_ORDER
      .filter(p => pillarsObj[p])
      .map(p => ({
        name: p,
        label: PILLAR_LABELS[p] || p,
        conversation: pillarsObj[p].conversation || [
          { role: 'assistant', content: pillarsObj[p].contextSummary || '' },
        ],
      }))
    if (pillarInputs.length === 0) return { error: 'No interview data found for this session.' }

    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, pillars: pillarInputs, language: session.language || 'English', hasEmployees: session.has_employees }),
    })
    const data = await res.json()
    if (data.error || !data.report) return { error: 'Failed to generate report.' }
    generated = data.report
    genUsage = data.usage
    refreshedPillars = data.pillars || null
  } else {
    // Legacy (pre-pillar) sessions: original per-response report path.
    const { data: responses } = await supabase
      .from('responses')
      .select('*, questions(core_question)')
      .eq('session_id', sessionId)
    if (!responses || responses.length === 0) return { error: 'No responses found for this session.' }
    const formatted = responses.map((r: any) => ({
      question: r.questions?.core_question || 'Unknown question',
      conversation: r.conversation || [],
    }))
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, responses: formatted, language: session.language || 'English' }),
    })
    const reportData = await res.json()
    if (reportData.error || !reportData.report) return { error: 'Failed to generate report.' }
    generated = reportData.report
    genUsage = reportData.usage
  }

  // Fold the generation call's tokens into the session's cost total
  await addSessionUsage(sessionId, genUsage)

  // Persist report + scores + status so revisits serve the stored version.
  // Also persist firmographics (benchmark fields) extracted from the full
  // transcript into dedicated, queryable columns.
  const scoreMap: Record<string, number> = {}
  if (generated.areas?.length > 0) generated.areas.forEach((a: AreaScore) => { scoreMap[a.category] = a.score })

  const f = generated.firmographics || {}
  const firmoPatch: Record<string, any> = {}
  if (f.niche != null) firmoPatch.niche = f.niche
  if (typeof f.employee_count === 'number') firmoPatch.employee_count = f.employee_count
  if (f.size_band != null) firmoPatch.size_band = f.size_band
  if (f.revenue_band != null) firmoPatch.revenue_band = f.revenue_band
  if (typeof f.years_in_business === 'number') firmoPatch.years_in_business = f.years_in_business
  if (f.region != null) firmoPatch.region = f.region

  // For v2 sessions, fold the synthesis' refreshed pillar deep-dives back into
  // dashboard_cache, overwriting the incremental (possibly stubbed) situation /
  // recommendation / entities while preserving the raw conversation + metadata.
  const updatePatch: Record<string, any> = {
    status: 'completed',
    scores: Object.keys(scoreMap).length > 0 ? scoreMap : null,
    report: generated,
    ...firmoPatch,
  }
  if (isV2 && refreshedPillars && Object.keys(refreshedPillars).length > 0) {
    const pillarsObj: Record<string, any> = { ...(session.dashboard_cache?.pillars || {}) }
    for (const [name, d] of Object.entries(refreshedPillars)) {
      if (!pillarsObj[name]) continue
      const rd = d as any
      pillarsObj[name] = {
        ...pillarsObj[name],
        situation: rd.situation ?? pillarsObj[name].situation,
        recommendation: rd.recommendation ?? pillarsObj[name].recommendation,
        confidence: typeof rd.confidence === 'number' ? rd.confidence : pillarsObj[name].confidence,
        entities: rd.entities ?? pillarsObj[name].entities,
        dataGaps: rd.dataGaps ?? pillarsObj[name].dataGaps,
      }
    }
    updatePatch.dashboard_cache = { v: 2, pillars: pillarsObj }
  }

  await supabase.from('sessions').update(updatePatch).eq('id', sessionId)

  // Fire pattern-match in background — updates admin pattern slots, non-blocking
  fetch('/api/pattern-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => { /* non-critical */ })

  return { report: generated, businessName }
}
