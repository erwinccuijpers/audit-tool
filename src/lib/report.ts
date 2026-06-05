import { supabase } from '@/lib/supabase'
import { addSessionUsage } from '@/lib/usage'

export type AreaScore = { category: string; score: number; label: string; insight: string; opportunity: string }
export type QuickWin = { title: string; desc: string; effort: number; impact: number }
export type BigBet = { title: string; desc: string; mvp: string }
export type Report = { summary: string; areas: AreaScore[]; quickWins: QuickWin[]; bigBets: BigBet[] }

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

  if (isV2) {
    // Pillar sessions: /api/synthesize runs the full-transcript pass AND persists
    // the report/scores/firmographics/pillars server-side. We pass only the id —
    // the route reads everything else. Server-side persistence means a dropped
    // connection can no longer lose the report (the hub/results loaders poll the
    // DB for it via loadReport below).
    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, force: opts.force }),
    })
    const data = await res.json()
    if (data.error || !data.report) return { error: 'Failed to generate report.' }
    return { report: data.report as Report, businessName }
  }

  // Legacy (pre-pillar) sessions: original per-response report path, persisted here
  // on the client (these are old sessions, not the current pillar flow).
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
  const generated = reportData.report

  // Fold the generation call's tokens into the session's cost total
  await addSessionUsage(sessionId, reportData.usage)

  // Persist report + scores + status so revisits serve the stored version, plus
  // firmographics (benchmark fields) into dedicated, queryable columns.
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

// Resilient report loader for the hub + results pages. Triggers generation
// (idempotent + persisted server-side by /api/synthesize) AND polls the DB, so
// the finished report is picked up even if the triggering request is dropped —
// e.g. a mobile browser suspends the tab mid-synthesis. Returns a cleanup fn the
// caller should run on unmount.
export function loadReport(
  sessionId: string,
  onReady: (report: Report, businessName: string) => void,
  onError: (message: string) => void,
): () => void {
  let settled = false
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = () => { if (timer) { clearInterval(timer); timer = null } }
  const ok = (report: Report, businessName: string) => {
    if (settled) return
    settled = true; stop(); onReady(report, businessName)
  }
  const fail = (message: string) => {
    if (settled) return
    settled = true; stop(); onError(message)
  }

  // Fire generation. A clean return renders immediately; if the request dies
  // (backgrounded tab, flaky mobile connection) the poll below is the safety net.
  ensureReport(sessionId)
    .then(res => {
      if (res.report) ok(res.report, res.businessName || '')
      // Only surface hard, non-recoverable errors. A transient generation failure
      // may still resolve via the server-side write that the poll will catch.
      else if (res.error && /not complete|not found|no interview data|no responses/i.test(res.error)) fail(res.error)
    })
    .catch(() => { /* poll is the safety net */ })

  // Poll the DB as the safety net: ~4 min ceiling (60 × 4s), inside the route's
  // 300s maxDuration.
  let tries = 0
  timer = setInterval(async () => {
    if (settled) return
    tries += 1
    const { data } = await supabase
      .from('sessions')
      .select('report, business_name')
      .eq('id', sessionId)
      .single()
    if (data?.report) ok(data.report as Report, data.business_name || '')
    else if (tries >= 60) fail('This is taking longer than usual — refresh in a moment and your report will be ready.')
  }, 4000)

  return stop
}
