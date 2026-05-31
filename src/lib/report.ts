import { supabase } from '@/lib/supabase'
import { addSessionUsage } from '@/lib/usage'

export type AreaScore = { category: string; score: number; label: string; insight: string; opportunity: string }
export type QuickWin = { title: string; desc: string; effort: number; impact: number }
export type BigBet = { title: string; desc: string; mvp: string }
export type Report = { summary: string; areas: AreaScore[]; quickWins: QuickWin[]; bigBets: BigBet[] }

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']

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

  // Build the interview transcript the report route expects
  let formatted: { question: string; conversation: any[] }[] = []

  if (session.dashboard_cache?.v === 2) {
    const pillars: Record<string, any> = session.dashboard_cache?.pillars || {}
    formatted = PILLAR_ORDER
      .filter(p => pillars[p])
      .map(p => ({
        question: p.charAt(0).toUpperCase() + p.slice(1),
        conversation: pillars[p].conversation || [
          { role: 'assistant', content: pillars[p].contextSummary || '' },
        ],
      }))
  } else {
    const { data: responses } = await supabase
      .from('responses')
      .select('*, questions(core_question)')
      .eq('session_id', sessionId)
    if (!responses || responses.length === 0) return { error: 'No responses found for this session.' }
    formatted = responses.map((r: any) => ({
      question: r.questions?.core_question || 'Unknown question',
      conversation: r.conversation || [],
    }))
  }

  if (formatted.length === 0) return { error: 'No interview data found for this session.' }

  const res = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, responses: formatted, language: session.language || 'English' }),
  })
  const reportData = await res.json()
  const { report: generated, error: apiError } = reportData
  if (apiError || !generated) return { error: 'Failed to generate report.' }

  // Fold the report call's tokens into the session's cost total
  await addSessionUsage(sessionId, reportData.usage)

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

  await supabase.from('sessions').update({
    status: 'completed',
    scores: Object.keys(scoreMap).length > 0 ? scoreMap : null,
    report: generated,
    ...firmoPatch,
  }).eq('id', sessionId)

  // Fire pattern-match in background — updates admin pattern slots, non-blocking
  fetch('/api/pattern-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => { /* non-critical */ })

  return { report: generated, businessName }
}
