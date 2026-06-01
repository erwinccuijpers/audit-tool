'use client'
import { useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

const ADMIN_EMAIL = 'erwinccuijpers@gmail.com'

type Session = {
  id: string
  business_name: string
  business_type: string
  industry: string
  business_description: string
  owner_tone: string
  status: string
  current_q_index: number
  completed_summaries: { question: string; summary: string }[]
  created_at: string
  user_id?: string | null
  admin_analysis?: any
  dashboard_cache?: any
  questions_completed?: number
  input_tokens?: number | null
  output_tokens?: number | null
  cost_usd?: number | null
  niche?: string | null
  employee_count?: number | null
  size_band?: string | null
  revenue_band?: string | null
  years_in_business?: number | null
  region?: string | null
  country?: string | null
  city?: string | null
  scores?: Record<string, number> | null
  is_test?: boolean | null
}

// True for new pillar-architecture sessions
const isPillarSession = (s: Session) => s.dashboard_cache?.v === 2
// Data count: number of covered topics/pillars
const topicCount = (s: Session) => isPillarSession(s)
  ? Object.keys(s.dashboard_cache?.pillars || {}).length
  : (s.completed_summaries || []).length
// Has any interview data
const sessionHasData = (s: Session) => topicCount(s) > 0
// Is completed (both old and new status values)
const isCompleted = (s: Session) => s.status === 'completed' || s.status === 'interview_done'

type Message = { role: 'user' | 'assistant'; content: string }

// ── Shared styles ─────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'monospace' }
const label = (extra?: React.CSSProperties): React.CSSProperties => ({
  ...mono, fontSize: 9, letterSpacing: '0.12em', color: '#3A3A28', ...extra,
})
const card = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: '#111110', border: '1px solid #1A1A14', borderRadius: 8,
  padding: '16px', ...extra,
})
const tag = (color: string, bg: string): React.CSSProperties => ({
  ...mono, fontSize: 9, letterSpacing: '0.08em', color,
  background: bg, border: `1px solid ${color}30`, borderRadius: 3, padding: '2px 7px',
})

function effortColor(v: string) {
  if (v === 'low') return { color: '#7AAA7A', bg: '#0A120A' }
  if (v === 'high') return { color: '#C07050', bg: '#120A08' }
  return { color: '#C8A96E', bg: '#120E08' }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ ...label(), marginBottom: 10 }}>{children}</div>
  )
}

const BUCKET_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people', 'outliers'] as const
type BucketName = typeof BUCKET_ORDER[number]

type PatternIssue = {
  id: string
  description: string
  count: number
  affected: { session_id: string; business_name: string; quote: string }[]
}

type ProcessedMeta = { summary_count: number; processed_at: string }
type BucketCache = {
  buckets: Partial<Record<BucketName, { issues: PatternIssue[] }>>
  processed_sessions: Record<string, ProcessedMeta>
}

function IssueCard({ issue, isOutlier, onMove }: {
  issue: PatternIssue
  isOutlier: boolean
  onMove?: (issueId: string, toBucket: BucketName) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid #141412', paddingBottom: 10, marginBottom: 10 }}>
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{
          ...mono, fontSize: 13, color: '#C8A96E', minWidth: 24, textAlign: 'right', flexShrink: 0,
        }}>{issue.count}×</span>
        <div style={{ flex: 1 }}>
          <span style={{ color: '#B0A890', fontSize: 13, lineHeight: 1.5 }}>{issue.description}</span>
        </div>
        <span style={{ ...mono, fontSize: 9, color: '#2A2A1E', flexShrink: 0, paddingTop: 3 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {open && (
        <div style={{ paddingLeft: 34, marginTop: 10 }}>
          {/* Businesses */}
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.1em', color: '#3A3A28', marginBottom: 8 }}>
            BUSINESSES AFFECTED
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: isOutlier ? 12 : 0 }}>
            {issue.affected.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 130px' }}>
                  <div style={{ color: '#9A9080', fontSize: 12 }}>{a.business_name}</div>
                  <a
                    href={`/?session=${a.session_id}`}
                    onClick={e => e.stopPropagation()}
                    style={{ ...mono, fontSize: 9, color: '#3A3A28', textDecoration: 'none' }}
                  >view →</a>
                </div>
                <div style={{ flex: 1, color: '#4A4A38', ...mono, fontSize: 11, lineHeight: 1.5, fontStyle: 'italic' }}>
                  "{a.quote}"
                </div>
              </div>
            ))}
          </div>

          {/* Move to bucket (outliers only) */}
          {isOutlier && onMove && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...mono, fontSize: 10, color: '#3A3A28' }}>Move to →</span>
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) onMove(issue.id, e.target.value as BucketName) }}
                onClick={e => e.stopPropagation()}
                style={{
                  background: '#0C0C09', border: '1px solid #1E1E14', borderRadius: 4,
                  color: '#C8A96E', ...mono, fontSize: 11, padding: '4px 8px', cursor: 'pointer',
                }}
              >
                <option value="">select bucket…</option>
                {BUCKET_ORDER.filter(b => b !== 'outliers').map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryBucketsView({ sessions, isFullAdmin, onReloadSessions, sessionsLoading, dataMode }: { sessions: Session[]; isFullAdmin: boolean; onReloadSessions: () => Promise<void>; sessionsLoading: boolean; dataMode: 'real' | 'demo' }) {
  const [cache, setCache] = useState<BucketCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [processMsg, setProcessMsg] = useState('')
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set(['retention', 'acquisition']))
  // Real and Demo patterns live in separate caches so they never mix.
  const cacheKey = `pattern_slots_${dataMode}`

  const processedSessions = cache?.processed_sessions ?? {}
  const unprocessedCount = sessions.filter(s => {
    const currentCount = topicCount(s)   // handles both pillar and legacy sessions
    if (currentCount === 0) return false
    const prev = processedSessions[s.id]
    return !prev || currentCount > prev.summary_count
  }).length

  // Reload the cache whenever the Real/Demo mode changes — they're separate stores.
  useEffect(() => {
    setLoading(true)
    setCache(null)
    supabase
      .from('admin_cache')
      .select('data')
      .eq('key', cacheKey)
      .single()
      .then(({ data }) => {
        setCache(data?.data?.buckets ? data.data : null)
        setLoading(false)
      })
  }, [cacheKey])

  async function processNew() {
    setProcessing(true)
    setProcessMsg('')
    const res = await fetch('/api/pattern-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: dataMode }),
    })
    const data = await res.json()
    if (data.error) { setProcessMsg(`Error: ${data.error}`); setProcessing(false); return }
    setProcessMsg(`Processed ${data.processed} ${dataMode} session${data.processed !== 1 ? 's' : ''} — ${data.totalIssues} issues total`)
    const { data: refreshed } = await supabase.from('admin_cache').select('data').eq('key', cacheKey).single()
    if (refreshed?.data?.buckets) setCache(refreshed.data)
    setProcessing(false)
  }

  async function moveIssue(issueId: string, toBucket: BucketName) {
    if (!cache) return
    const outlierIssues = cache.buckets.outliers?.issues ?? []
    const issue = outlierIssues.find(i => i.id === issueId)
    if (!issue) return

    const updated: BucketCache = {
      ...cache,
      buckets: {
        ...cache.buckets,
        outliers: { issues: outlierIssues.filter(i => i.id !== issueId) },
        [toBucket]: {
          issues: [...(cache.buckets[toBucket]?.issues ?? []), issue].sort((a, b) => b.count - a.count),
        },
      },
    }
    setCache(updated)

    // Persist
    await supabase.from('admin_cache').upsert(
      { key: cacheKey, data: updated, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    setOpenBuckets(prev => new Set([...prev, toBucket]))
  }

  function toggleBucket(b: string) {
    setOpenBuckets(prev => {
      const next = new Set(prev)
      next.has(b) ? next.delete(b) : next.add(b)
      return next
    })
  }

  const totalIssues = cache
    ? BUCKET_ORDER.reduce((n, b) => n + (cache.buckets[b]?.issues.length ?? 0), 0)
    : 0

  if (loading) {
    return <div style={{ ...mono, fontSize: 12, color: '#3A3A28', padding: '40px 0', textAlign: 'center' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          onClick={async () => {
            setProcessMsg('')
            await onReloadSessions()
            const { data: refreshed } = await supabase.from('admin_cache').select('data').eq('key', cacheKey).single()
            if (refreshed?.data?.buckets) setCache(refreshed.data)
          }}
          disabled={sessionsLoading || processing}
          title="Re-check Supabase for new completed sessions"
          style={{
            background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 6,
            padding: '9px 16px', color: sessionsLoading ? '#3A3A28' : '#8A8070',
            ...mono, fontSize: 12, cursor: sessionsLoading || processing ? 'default' : 'pointer',
          }}
        >
          {sessionsLoading ? 'Reloading…' : '↻ Reload data'}
        </button>
        {isFullAdmin && (
          <button
            onClick={processNew}
            disabled={processing || unprocessedCount === 0}
            style={{
              background: processing || unprocessedCount === 0 ? '#1A1A14' : '#C8A96E',
              border: 'none', borderRadius: 6, padding: '9px 18px',
              color: processing || unprocessedCount === 0 ? '#3A3A28' : '#0C0C09',
              ...mono, fontSize: 12, cursor: processing || unprocessedCount === 0 ? 'default' : 'pointer',
            }}
          >
            {processing ? 'Processing…' : unprocessedCount > 0
              ? `▶ Process ${unprocessedCount} session${unprocessedCount !== 1 ? 's' : ''}`
              : '✓ Up to date'}
          </button>
        )}
        <span style={{ ...mono, fontSize: 11, color: '#3A3A28' }}>
          {totalIssues} issue{totalIssues !== 1 ? 's' : ''} · {Object.keys(processedSessions).length} sessions in database
        </span>
        {processMsg && (
          <span style={{ ...mono, fontSize: 11, color: processMsg.startsWith('Error') ? '#C07050' : '#6A9A6A' }}>
            {processMsg}
          </span>
        )}
      </div>

      {/* Top 5 most common issues */}
      {totalIssues > 0 && (() => {
        const top5 = BUCKET_ORDER
          .flatMap(b => (cache?.buckets[b]?.issues ?? []).map(iss => ({ ...iss, bucket: b })))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
        return (
          <div style={card({ padding: '14px 16px' })}>
            <div style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', color: '#3A3A28', marginBottom: 12 }}>
              TOP ISSUES ACROSS ALL CLIENTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5.map((iss, i) => (
                <div key={iss.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ ...mono, fontSize: 10, color: '#2A2A1E', minWidth: 14 }}>{i + 1}.</span>
                  <span style={{ flex: 1, color: '#B0A890', fontSize: 13, lineHeight: 1.4 }}>{iss.description}</span>
                  <span style={{
                    ...mono, fontSize: 10, color: '#3A3A28',
                    background: '#1A1A14', border: '1px solid #222218',
                    borderRadius: 3, padding: '1px 6px', flexShrink: 0,
                  }}>{iss.bucket}</span>
                  <span style={{ ...mono, fontSize: 12, color: '#C8A96E', minWidth: 24, textAlign: 'right', flexShrink: 0 }}>
                    {iss.count}×
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Empty state */}
      {totalIssues === 0 && !processing && (
        <div style={card({ textAlign: 'center', padding: '40px 20px' })}>
          <div style={{ ...mono, fontSize: 12, color: '#3A3A28', marginBottom: 6 }}>No issues classified yet</div>
          <div style={{ ...mono, fontSize: 11, color: '#2A2A1E' }}>
            {sessions.some(s => (s.completed_summaries || []).length > 0)
              ? 'Click "Process sessions" to classify issues from interviews into category buckets.'
              : 'Issues appear once sessions have data.'}
          </div>
        </div>
      )}

      {/* Category buckets */}
      {BUCKET_ORDER.map(bucketName => {
        const issues = cache?.buckets[bucketName]?.issues ?? []
        const isOpen = openBuckets.has(bucketName)
        const isOutlier = bucketName === 'outliers'
        const bucketLabel = bucketName.charAt(0).toUpperCase() + bucketName.slice(1)

        return (
          <div key={bucketName} style={card({ padding: 0 })}>
            {/* Bucket header */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: isOpen && issues.length > 0 ? '1px solid #161614' : 'none',
              }}
              onClick={() => toggleBucket(bucketName)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  ...mono, fontSize: 10, letterSpacing: '0.12em',
                  color: isOutlier ? '#4A4A38' : issues.length > 0 ? '#C8A96E' : '#2A2A1E',
                }}>
                  {bucketLabel.toUpperCase()}
                </span>
                {issues.length > 0 && (
                  <span style={{
                    background: isOutlier ? '#1A1A14' : '#1E1A10',
                    border: `1px solid ${isOutlier ? '#2A2A20' : '#C8A96E30'}`,
                    borderRadius: 10, padding: '1px 7px',
                    ...mono, fontSize: 10, color: isOutlier ? '#4A4A38' : '#C8A96E',
                  }}>
                    {issues.length} issue{issues.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <span style={{ ...mono, fontSize: 10, color: '#2A2A1E' }}>
                {issues.length === 0 ? 'no issues yet' : isOpen ? '▲' : '▼'}
              </span>
            </div>

            {/* Issues list */}
            {isOpen && issues.length > 0 && (
              <div style={{ padding: '14px 16px' }}>
                {issues.map(issue => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    isOutlier={isOutlier}
                    onMove={isOutlier ? moveIssue : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FunnelView({ sessions, dataMode }: { sessions: Session[]; dataMode: 'real' | 'demo' }) {
  // Product-interest leads (service-role summary; respects Real/Demo).
  const [leads, setLeads] = useState<{ summary: Record<string, { interested: number; not_interested: number }>; uniqueInterestedEmails: number; suggestions?: { email: string | null; note: string; created_at: string }[] } | null>(null)
  useEffect(() => {
    let active = true
    fetch(`/api/leads-summary?mode=${dataMode}`).then(r => r.json()).then(d => { if (active) setLeads(d) }).catch(() => {})
    return () => { active = false }
  }, [dataMode])

  const total = sessions.length
  const anyActivity = sessions.filter(s => (s.current_q_index || 0) > 0).length
  const reachedQ6 = sessions.filter(s => (s.current_q_index || 0) >= 6).length
  const hasSummaries = sessions.filter(sessionHasData).length
  const completed = sessions.filter(isCompleted).length
  const authenticated = sessions.filter(s => s.user_id != null).length
  const anonymous = sessions.filter(s => s.user_id == null).length

  // Cost overview — segmented by completed vs in-progress/churned.
  // Cost is now persisted incrementally per turn, so unfinished sessions carry spend too.
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0)
  const completedWithCost = sessions.filter(s => isCompleted(s) && s.cost_usd != null)
  const completedCost = completedWithCost.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0)
  const avgCompletedCost = completedWithCost.length > 0 ? completedCost / completedWithCost.length : 0
  // Churned = unfinished but already cost something (a real lead with partial data → follow-up candidate)
  const churnedWithCost = sessions.filter(s => !isCompleted(s) && (s.cost_usd ?? 0) > 0)
  const churnedCost = churnedWithCost.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0)
  const avgChurnedCost = churnedWithCost.length > 0 ? churnedCost / churnedWithCost.length : 0

  // Drop-off distribution: bucket current_q_index into ranges
  const buckets = [
    { label: '0 (never started)', min: 0, max: 0 },
    { label: 'Q1–5 (early drop)', min: 1, max: 5 },
    { label: 'Q6–10', min: 6, max: 10 },
    { label: 'Q11–20', min: 11, max: 20 },
    { label: 'Q21–30', min: 21, max: 30 },
    { label: 'Q31+ (deep)', min: 31, max: 999 },
  ]
  const bucketCounts = buckets.map(b => ({
    ...b,
    count: sessions.filter(s => {
      const qi = s.current_q_index || 0
      return qi >= b.min && qi <= b.max
    }).length,
    authed: sessions.filter(s => {
      const qi = s.current_q_index || 0
      return qi >= b.min && qi <= b.max && s.user_id != null
    }).length,
  }))

  const maxBucket = Math.max(...bucketCounts.map(b => b.count), 1)

  function FunnelRow({ label: lbl, value, total: tot, note }: { label: string; value: number; total: number; note?: string }) {
    const pct = tot > 0 ? Math.round((value / tot) * 100) : 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ width: 160, color: '#6A6A52', ...mono, fontSize: 11, flexShrink: 0 }}>{lbl}</div>
        <div style={{ flex: 1, height: 6, background: '#1A1A14', borderRadius: 3 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#C8A96E', borderRadius: 3, transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ width: 56, textAlign: 'right', ...mono, fontSize: 11, color: '#D0C8B8', flexShrink: 0 }}>{value}</div>
        <div style={{ width: 36, textAlign: 'right', ...mono, fontSize: 10, color: '#3A3A28', flexShrink: 0 }}>{pct}%</div>
        {note && <div style={{ ...mono, fontSize: 10, color: '#3A3A28' }}>{note}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {[
          { label: 'TOTAL SESSIONS', value: total },
          { label: 'AUTHENTICATED', value: authenticated },
          { label: 'ANONYMOUS', value: anonymous },
          { label: 'WITH SUMMARIES', value: hasSummaries },
          { label: 'COMPLETED', value: completed },
          { label: 'TOTAL COST', value: `$${totalCost.toFixed(2)}` },
          { label: 'AVG / COMPLETED', value: `$${avgCompletedCost.toFixed(2)}` },
        ].map(({ label: lbl, value }) => (
          <div key={lbl} style={card({ textAlign: 'center', padding: '14px 12px' })}>
            <div style={{ color: '#D0C8B8', fontFamily: 'monospace', fontSize: 22, fontWeight: 300, marginBottom: 4 }}>{value}</div>
            <div style={{ ...label(), fontSize: 9 }}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Cost breakdown — completed vs churned spend */}
      <div style={card()}>
        <SectionLabel>COST BREAKDOWN</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 4 }}>
          {[
            { lbl: 'TOTAL SPEND', val: `$${totalCost.toFixed(2)}`, sub: `${completedWithCost.length + churnedWithCost.length} sessions w/ cost`, accent: '#C8A96E' },
            { lbl: 'COMPLETED', val: `$${completedCost.toFixed(2)}`, sub: `${completedWithCost.length} · avg $${avgCompletedCost.toFixed(2)}`, accent: '#7AAA7A' },
            { lbl: 'CHURNED (LEADS)', val: `$${churnedCost.toFixed(2)}`, sub: `${churnedWithCost.length} · avg $${avgChurnedCost.toFixed(2)}`, accent: '#E0905A' },
          ].map(c => (
            <div key={c.lbl} style={{ background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ color: c.accent, fontFamily: 'monospace', fontSize: 20, fontWeight: 300 }}>{c.val}</div>
              <div style={{ ...label(), fontSize: 9, marginTop: 4 }}>{c.lbl}</div>
              <div style={{ ...mono, fontSize: 9, color: '#3A3A28', marginTop: 4 }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ ...mono, fontSize: 9, color: '#2A2A20', marginTop: 10 }}>
          Churned = unfinished sessions that already incurred cost — partial data captured, worth a follow-up.
        </div>
      </div>

      {/* Product interest — lead-gen signals from the dashboard */}
      <div style={card()}>
        <SectionLabel>PRODUCT INTEREST</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 4 }}>
          {[
            { lbl: 'NEWSLETTER', key: 'newsletter', accent: '#C8A96E' },
            { lbl: 'WORK YOUR PLAN', key: 'work_your_plan', accent: '#9A8A6A' },
            { lbl: 'SUGGESTIONS', key: 'open_suggestions', accent: '#7EB8A4' },
            { lbl: 'UNIQUE LEAD EMAILS', key: '__emails', accent: '#7AAA7A' },
          ].map(c => {
            const s = leads?.summary?.[c.key]
            const val = c.key === '__emails' ? (leads?.uniqueInterestedEmails ?? 0) : (s?.interested ?? 0)
            const sub = c.key === '__emails'
              ? 'interested, deduped'
              : `${s?.interested ?? 0} in · ${s?.not_interested ?? 0} out`
            return (
              <div key={c.lbl} style={{ background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 6, padding: '12px 14px' }}>
                <div style={{ color: c.accent, fontFamily: 'monospace', fontSize: 20, fontWeight: 300 }}>{val}</div>
                <div style={{ ...label(), fontSize: 9, marginTop: 4 }}>{c.lbl}</div>
                <div style={{ ...mono, fontSize: 9, color: '#3A3A28', marginTop: 4 }}>{sub}</div>
              </div>
            )
          })}
        </div>
        <div style={{ ...mono, fontSize: 9, color: '#2A2A20', marginTop: 10 }}>
          Captured from the dashboard email0 preview + Work-your-plan card. {dataMode === 'demo' ? 'Showing demo leads.' : 'Real leads only.'}
        </div>
        {leads?.suggestions && leads.suggestions.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid #1A1A14', paddingTop: 12 }}>
            <div style={{ ...mono, fontSize: 9, letterSpacing: '0.12em', color: '#7EB8A4', marginBottom: 8 }}>OPEN SUGGESTIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leads.suggestions.map((s, i) => (
                <div key={i} style={{ background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 12, color: '#C0B8A8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{s.note}</div>
                  <div style={{ ...mono, fontSize: 9, color: '#3A3A28', marginTop: 6 }}>
                    {s.email || 'no email'} · {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Conversion funnel */}
      <div style={card()}>
        <SectionLabel>CONVERSION FUNNEL</SectionLabel>
        <FunnelRow label="Sessions started" value={total} total={total} />
        <FunnelRow label="Any activity" value={anyActivity} total={total} />
        <FunnelRow label="Reached Q6 (save prompt)" value={reachedQ6} total={total} />
        <FunnelRow label="Has summaries" value={hasSummaries} total={total} />
        <FunnelRow label="Completed" value={completed} total={total} />
      </div>

      {/* Auth breakdown */}
      <div style={card()}>
        <SectionLabel>AUTH BREAKDOWN</SectionLabel>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: authenticated, height: 10, background: '#4A6A4A', borderRadius: '3px 0 0 3px', minWidth: 2 }} />
          <div style={{ flex: anonymous, height: 10, background: '#5A3A28', borderRadius: '0 3px 3px 0', minWidth: 2 }} />
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span style={{ ...mono, fontSize: 11, color: '#7AAA7A' }}>{authenticated} authenticated ({total > 0 ? Math.round(authenticated / total * 100) : 0}%)</span>
          <span style={{ ...mono, fontSize: 11, color: '#C07050' }}>{anonymous} anonymous ({total > 0 ? Math.round(anonymous / total * 100) : 0}%)</span>
        </div>
      </div>

      {/* Drop-off distribution */}
      <div style={card()}>
        <SectionLabel>DROP-OFF BY QUESTION</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bucketCounts.map(b => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 180, ...mono, fontSize: 10, color: '#4A4A38', flexShrink: 0 }}>{b.label}</div>
              <div style={{ flex: 1, height: 16, background: '#111110', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.round((b.count / maxBucket) * 100)}%`,
                  height: '100%',
                  background: '#1E1E14',
                  borderRadius: 3,
                  position: 'absolute',
                }} />
                <div style={{
                  width: `${Math.round((b.authed / maxBucket) * 100)}%`,
                  height: '100%',
                  background: '#2A3A2A',
                  borderRadius: 3,
                  position: 'absolute',
                }} />
              </div>
              <div style={{ ...mono, fontSize: 11, color: '#D0C8B8', width: 28, textAlign: 'right', flexShrink: 0 }}>{b.count}</div>
              <div style={{ ...mono, fontSize: 10, color: '#3A4A3A', width: 28, textAlign: 'right', flexShrink: 0 }}>{b.authed}✓</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
          <span style={{ ...mono, fontSize: 9, color: '#2A2A20' }}>■ total sessions</span>
          <span style={{ ...mono, fontSize: 9, color: '#2A3A2A' }}>■ authenticated only</span>
        </div>
      </div>

    </div>
  )
}

type RawResponse = {
  question_id: string
  conversation: { role: string; content: string }[]
  updated_at: string
}

// ── Admin transcript modal ──────────────────────────────────────────────────
// Standalone admin view — reconstructs the full conversation without leaving
// the admin context (the old "transcript ↗" link routed into the client app).
const TRANSCRIPT_PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']
const TRANSCRIPT_PILLAR_LABELS: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

function TranscriptModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function build() {
      // ── Pillar-mode v:2 — reconstruct from stored pillar conversations ──
      if (isPillarSession(session)) {
        const pillars: Record<string, any> = session.dashboard_cache?.pillars || {}
        const combined: Message[] = []
        for (const name of TRANSCRIPT_PILLAR_ORDER) {
          const p = pillars[name]
          if (!p) continue
          const conv: Message[] = p.conversation || []
          if (conv.length === 0) continue
          combined.push({ role: 'assistant', content: `— ${TRANSCRIPT_PILLAR_LABELS[name] || name} —` })
          combined.push(...conv)
        }
        while (combined.length > 0 && combined[combined.length - 1].role === 'assistant') combined.pop()
        if (!cancelled) { setMessages(combined); setEmpty(combined.length === 0); setLoading(false) }
        return
      }

      // ── Legacy mode — reconstruct from responses table ──
      const { data: responses } = await supabase
        .from('responses')
        .select('conversation, created_at')
        .eq('session_id', session.id)
        .order('created_at')

      let all: Message[] = []
      let currentBest: Message[] = []
      let prevMax = 0
      for (const r of responses || []) {
        const conv: Message[] = (r.conversation as Message[]) || []
        if (conv.length === 0) continue
        if (conv.length < prevMax) { all = [...all, ...currentBest]; currentBest = conv; prevMax = conv.length }
        else { currentBest = conv; prevMax = conv.length }
      }
      if (currentBest.length > 0) all = [...all, ...currentBest]
      while (all.length > 0 && all[all.length - 1].role === 'assistant') all = all.slice(0, -1)
      if (!cancelled) { setMessages(all); setEmpty(all.length === 0); setLoading(false) }
    }
    build()
    return () => { cancelled = true }
  }, [session])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0C0C09', border: '1px solid #1E1E14', borderRadius: 10,
          width: '100%', maxWidth: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderBottom: '1px solid #1A1A14', flexShrink: 0,
        }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: '0.12em', color: '#4A4A38' }}>TRANSCRIPT</span>
          <span style={{ ...mono, fontSize: 12, color: '#C8A96E' }}>{session.business_name || '(no name)'}</span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', background: 'transparent', border: '1px solid #2A2A1E',
              borderRadius: 4, padding: '3px 10px', cursor: 'pointer', color: '#4A4A38', ...mono, fontSize: 11,
            }}
          >✕ close</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ color: '#3A3A28', ...mono, fontSize: 12, textAlign: 'center', padding: '40px 0' }}>Loading transcript…</div>
          ) : empty ? (
            <div style={{ color: '#3A3A28', ...mono, fontSize: 12, textAlign: 'center', padding: '40px 0' }}>
              No conversation recorded for this session.
            </div>
          ) : messages.map((msg, i) => {
            const isAssistant = msg.role === 'assistant'
            const isSectionLabel = isAssistant && msg.content.startsWith('—') && msg.content.endsWith('—')
            if (isSectionLabel) return (
              <div key={i} style={{ textAlign: 'center', padding: '14px 0 6px', ...mono, fontSize: 10, letterSpacing: '0.12em', color: '#3A3A28' }}>{msg.content}</div>
            )
            return (
              <div key={i} style={{ display: 'flex', justifyContent: isAssistant ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '80%',
                  background: isAssistant ? '#111110' : '#0F0F0A',
                  border: `1px solid ${isAssistant ? '#1E1E14' : '#161612'}`,
                  borderRadius: isAssistant ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                  padding: '9px 13px', color: isAssistant ? '#C8B070' : '#9A9888',
                  fontFamily: 'Georgia, serif', fontSize: 13.5, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{msg.content}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ClientCard({ session, adminEmail, allSessions }: { session: Session; adminEmail: string; allSessions: Session[] }) {
  const [expanded, setExpanded] = useState(false)
  const [analysis, setAnalysis] = useState<any>(session.admin_analysis || null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [rawResponses, setRawResponses] = useState<RawResponse[] | null>(null)
  const [rawLoading, setRawLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)

  function copyResumeLink(e: React.MouseEvent) {
    e.stopPropagation()
    const url = `${window.location.origin}/?resume=${session.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const summaryCount = topicCount(session)
  const pillar = isPillarSession(session)
  const totalTopics = pillar ? 7 : 35
  const pct = pillar
    ? Math.round((summaryCount / 7) * 100)
    : session.current_q_index ? Math.round((session.current_q_index / 35) * 100) : 0
  const isAnon = session.user_id == null
  const hasActivity = pillar ? summaryCount > 0 : (session.current_q_index || 0) > 0

  async function analyse() {
    setAnalysisLoading(true)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'client', sessions: allSessions, sessionId: session.id, adminEmail }),
    })
    const data = await res.json()
    setAnalysis(data.result)
    await supabase.from('sessions').update({ admin_analysis: data.result }).eq('id', session.id)
    setAnalysisLoading(false)
  }

  async function loadRawResponses() {
    setRawLoading(true)
    const { data, error } = await supabase
      .from('responses')
      .select('question_id, conversation, updated_at')
      .eq('session_id', session.id)
      .order('updated_at', { ascending: true })
    if (error) console.error('loadRawResponses:', error.message)
    setRawResponses((data as RawResponse[]) || [])
    setRawLoading(false)
  }

  return (
    <div style={card({ marginBottom: 8 })}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
      >
        <div style={{ flex: 1 }}>
          <span style={{ color: '#D0C8B8', ...mono, fontSize: 13 }}>
            {session.business_name || <span style={{ color: '#3A3A28' }}>(no name)</span>}
          </span>
          {session.business_type && (
            <span style={{ ...mono, fontSize: 10, color: '#3A3A28', marginLeft: 8 }}>
              {session.business_type} · {session.industry}
            </span>
          )}
        </div>
        {isAnon && (
          <span style={tag('#7A5A38', '#100C06')}>ANON</span>
        )}
        <span style={tag(isCompleted(session) ? '#7AAA7A' : '#8A6A30', isCompleted(session) ? '#0A120A' : '#120E08')}>
          {session.status}
        </span>
        <span style={{ ...mono, fontSize: 10, color: '#3A3A28' }}>
          {pillar ? `${summaryCount}/7 sections` : `${summaryCount} topics`}
        </span>
        {session.cost_usd != null && (
          <span style={{ ...mono, fontSize: 10, color: '#7A6A40' }} title={`${(session.input_tokens ?? 0).toLocaleString()} in / ${(session.output_tokens ?? 0).toLocaleString()} out tokens`}>
            ${session.cost_usd.toFixed(2)}
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); setShowTranscript(true) }}
          style={{
            background: 'transparent', border: '1px solid #2A2A1E',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
            color: '#3A3A28', ...mono, fontSize: 9, letterSpacing: '0.06em',
            flexShrink: 0, transition: 'color 0.2s, border-color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#C8A96E'; e.currentTarget.style.borderColor = '#C8A96E40' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#3A3A28'; e.currentTarget.style.borderColor = '#2A2A1E' }}
        >
          transcript
        </button>
        <button
          onClick={copyResumeLink}
          title="Copy resume link"
          style={{
            background: copied ? '#0A120A' : 'transparent',
            border: `1px solid ${copied ? '#3A5A3A' : '#2A2A1E'}`,
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
            color: copied ? '#7AAA7A' : '#3A3A28', ...mono, fontSize: 9,
            letterSpacing: '0.06em', transition: 'all 0.2s', flexShrink: 0,
          }}
        >
          {copied ? '✓ copied' : '⎘ link'}
        </button>
        <span style={{ color: '#2A2A20', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 8, height: 2, background: '#1A1A14', borderRadius: 1 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#2A2A1E', borderRadius: 1 }} />
      </div>
      {hasActivity && (
        <div style={{ ...mono, fontSize: 9, color: '#2A2A1E', marginTop: 3 }}>Q{session.current_q_index} reached</div>
      )}

      {expanded && (
        <div style={{ marginTop: 16 }}>

          {/* Sessions with no summaries: load raw responses */}
          {summaryCount === 0 && (
            <div style={{ marginBottom: 16 }}>
              {rawResponses === null ? (
                <button
                  onClick={e => { e.stopPropagation(); loadRawResponses() }}
                  disabled={rawLoading}
                  style={{
                    background: '#1A1410', border: '1px solid rgba(122,90,32,0.3)', borderRadius: 6,
                    padding: '8px 16px', color: rawLoading ? '#3A3A28' : '#8A6A40',
                    ...mono, fontSize: 11, cursor: rawLoading ? 'default' : 'pointer',
                  }}
                >
                  {rawLoading ? 'Loading...' : '↓ Load raw responses'}
                </button>
              ) : rawResponses.length === 0 ? (
                <div style={{ color: '#3A3A28', ...mono, fontSize: 11 }}>No saved responses found.</div>
              ) : (
                <div>
                  <SectionLabel>{`RAW RESPONSES (${rawResponses.length})`}</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {rawResponses.map((r, i) => {
                      const conv = r.conversation || []
                      // First assistant message is usually the question prompt
                      const firstAssistant = conv.find(m => m.role === 'assistant')
                      const lastUserMsg = [...conv].reverse().find(m => m.role === 'user')
                      const qLabel = firstAssistant
                        ? firstAssistant.content.slice(0, 120) + (firstAssistant.content.length > 120 ? '…' : '')
                        : r.question_id
                      return (
                        <div key={i} style={{ borderLeft: '2px solid #1A1A14', paddingLeft: 10 }}>
                          <div style={{ color: '#4A4A38', ...mono, fontSize: 10, marginBottom: 3, lineHeight: 1.4 }}>{qLabel}</div>
                          {lastUserMsg && (
                            <div style={{ color: '#7A7060', fontSize: 13, lineHeight: 1.5, fontFamily: 'Georgia, serif' }}>
                              {lastUserMsg.content.slice(0, 400)}{lastUserMsg.content.length > 400 ? '…' : ''}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pillar breakdown (v:2) — per-section confidence + DATA/GUT tag */}
          {pillar && summaryCount > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>SECTION QUALITY — DATA vs GUT</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TRANSCRIPT_PILLAR_ORDER.filter(n => session.dashboard_cache?.pillars?.[n]).map(name => {
                  const p = session.dashboard_cache.pillars[name]
                  const db = p.dataBacked
                  const tagStyle = db === true ? tag('#7AAA7A', '#0A120A') : db === false ? tag('#C08050', '#120C08') : tag('#5A5A48', '#111110')
                  return (
                    <div key={name} style={{ borderLeft: '2px solid #1A1A14', paddingLeft: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ color: '#9A9080', ...mono, fontSize: 11 }}>{TRANSCRIPT_PILLAR_LABELS[name] || name}</span>
                        <span style={tagStyle}>{db === true ? 'DATA' : db === false ? 'GUT' : 'UNTAGGED'}</span>
                        {typeof p.confidence === 'number' && (
                          <span style={{ ...mono, fontSize: 9, color: '#4A4A38' }}>{p.confidence}% conf</span>
                        )}
                      </div>
                      {p.situation && (
                        <div style={{ color: '#8A8070', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'Georgia, serif' }}>{p.situation}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Summaries (legacy per-question sessions) */}
          {!pillar && summaryCount > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>INTERVIEW DATA</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {session.completed_summaries.map((cs, i) => (
                  <div key={i} style={{ borderLeft: '2px solid #1A1A14', paddingLeft: 10 }}>
                    <div style={{ color: '#4A4A38', ...mono, fontSize: 10, marginBottom: 2 }}>{cs.question}</div>
                    <div style={{ color: '#8A8070', fontSize: 13, lineHeight: 1.55, fontFamily: 'Georgia, serif' }}>{cs.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analysis */}
          {summaryCount > 0 && (
            <div>
              {!analysis ? (
                <button
                  onClick={analyse}
                  disabled={analysisLoading}
                  style={{
                    background: analysisLoading ? '#1A1A14' : '#1A1410',
                    border: '1px solid rgba(200,169,110,0.2)', borderRadius: 6,
                    padding: '8px 16px', color: analysisLoading ? '#3A3A28' : '#C8A96E',
                    ...mono, fontSize: 11, cursor: analysisLoading ? 'default' : 'pointer',
                  }}
                >
                  {analysisLoading ? 'Analysing...' : '▶ Deep-dive analysis'}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <SectionLabel>DEEP-DIVE ANALYSIS</SectionLabel>

                  {analysis.top_challenges?.length > 0 && (
                    <div>
                      <div style={{ ...mono, fontSize: 10, color: '#C8A96E', marginBottom: 6 }}>TOP CHALLENGES</div>
                      {analysis.top_challenges.map((c: string, i: number) => (
                        <div key={i} style={{ color: '#9A9080', fontSize: 13, lineHeight: 1.6, paddingLeft: 12, position: 'relative', marginBottom: 4, fontFamily: 'Georgia, serif' }}>
                          <span style={{ position: 'absolute', left: 0, color: '#C8A96E' }}>·</span>{c}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.mindset_observations?.length > 0 && (
                    <div>
                      <div style={{ ...mono, fontSize: 10, color: '#9A6A4A', marginBottom: 6 }}>MINDSET PATTERNS</div>
                      {analysis.mindset_observations.map((m: any, i: number) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <div style={{ color: '#C07050', ...mono, fontSize: 11, marginBottom: 2 }}>{m.observation}</div>
                          <div style={{ color: '#4A4A38', ...mono, fontSize: 10, lineHeight: 1.5 }}>Evidence: {m.evidence}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.biggest_opportunity && (
                    <div style={{ background: '#0E1208', border: '1px solid rgba(122,154,122,0.2)', borderRadius: 6, padding: '10px 12px' }}>
                      <div style={{ ...mono, fontSize: 10, color: '#7AAA7A', marginBottom: 4 }}>BIGGEST OPPORTUNITY</div>
                      <div style={{ color: '#9AC09A', fontSize: 13, lineHeight: 1.6, fontFamily: 'Georgia, serif' }}>{analysis.biggest_opportunity}</div>
                    </div>
                  )}

                  {analysis.red_flags?.length > 0 && (
                    <div>
                      <div style={{ ...mono, fontSize: 10, color: '#C07050', marginBottom: 6 }}>RED FLAGS</div>
                      {analysis.red_flags.map((f: string, i: number) => (
                        <div key={i} style={{ color: '#7A4A30', ...mono, fontSize: 11, paddingLeft: 12, position: 'relative', marginBottom: 3 }}>
                          <span style={{ position: 'absolute', left: 0 }}>!</span>{f}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.next_conversation_topics?.length > 0 && (
                    <div>
                      <div style={{ ...mono, fontSize: 10, color: '#4A4A38', marginBottom: 6 }}>NEXT SESSION TOPICS</div>
                      {analysis.next_conversation_topics.map((t: string, i: number) => (
                        <div key={i} style={{ color: '#3A3A28', ...mono, fontSize: 11, paddingLeft: 12, position: 'relative', marginBottom: 3 }}>
                          <span style={{ position: 'absolute', left: 0 }}>→</span>{t}
                        </div>
                      ))}
                    </div>
                  )}

                  <button onClick={analyse} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2A2A20', ...mono, fontSize: 10, cursor: 'pointer' }}>
                    ↺ Re-analyse
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showTranscript && <TranscriptModal session={session} onClose={() => setShowTranscript(false)} />}
    </div>
  )
}

function ChatView({ sessions, adminEmail }: { sessions: Session[]; adminEmail: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        sessions,
        question: input,
        history: messages,
        adminEmail,
      }),
    })
    const data = await res.json()
    setMessages(prev => [...prev, { role: 'assistant', content: data.message || 'No response.' }])
    setLoading(false)
  }

  const suggestions = [
    'Top 10 clients by revenue band — table with industry, size, and location',
    'For retail businesses: most common problems with a count and a one-line situation each',
    'Rank industries by number of clients, with their average area scores',
    'Where are clients most likely flying blind with no data?',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0, paddingBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#3A3A28', ...mono, fontSize: 11, marginBottom: 4 }}>SUGGESTED QUESTIONS</div>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setInput(s)}
                style={{
                  background: '#111110', border: '1px solid #1A1A14', borderRadius: 6,
                  padding: '10px 14px', color: '#4A4A38', ...mono, fontSize: 12,
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#2A2A1E')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1A1A14')}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%',
              background: msg.role === 'user' ? '#1A1A12' : '#111110',
              border: `1px solid ${msg.role === 'user' ? '#2A2A1E' : '#1A1A14'}`,
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              padding: '12px 16px', color: '#D0C8B8',
              fontSize: msg.role === 'user' ? 14 : 12.5,
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              // Monospace for assistant so markdown tables / rankings stay aligned
              fontFamily: 'monospace',
              overflowX: 'auto',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{ background: '#111110', border: '1px solid #1A1A14', borderRadius: '16px 16px 16px 4px', padding: '12px 16px' }}>
              <span style={{ color: '#3A3A28', ...mono, fontSize: 12 }}>thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid #1A1A14' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask anything about your clients..."
          rows={2}
          style={{
            flex: 1, background: '#111110', border: '1px solid #222218',
            borderRadius: 10, padding: '10px 14px', color: '#E8E0D0',
            ...mono, fontSize: 13, outline: 'none', resize: 'none', lineHeight: 1.5,
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            background: loading || !input.trim() ? '#1A1A14' : '#C8A96E',
            border: 'none', borderRadius: 10, padding: '0 18px',
            color: loading || !input.trim() ? '#4A4A38' : '#0C0C09',
            ...mono, fontSize: 13, fontWeight: 500,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            minWidth: 64, flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function FeedbackView() {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState<'bug' | 'product'>('bug')
  const [showReviewed, setShowReviewed] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resolutionInputs, setResolutionInputs] = useState<Record<string, string>>({})
  const [markingId, setMarkingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    supabase
      .from('feedback')
      .select('id, category, feedback_type, recommendation, feedback_text, created_at, reviewed, resolution_note, ai_summary, session_snapshot, error_context, user_email, session_id, sessions(business_name, business_type, industry)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('FeedbackView:', error.message)
        setEntries(data || [])
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [])

  async function markReviewed(id: string) {
    setMarkingId(id)
    const note = resolutionInputs[id] || ''
    await supabase.from('feedback').update({ reviewed: true, resolution_note: note || null }).eq('id', id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, reviewed: true, resolution_note: note } : e))
    setMarkingId(null)
    setExpandedId(null)
  }

  if (loading) {
    return <div style={{ color: '#3A3A28', ...mono, fontSize: 12, textAlign: 'center', padding: 40 }}>Loading feedback...</div>
  }

  const filtered = entries.filter(f => {
    const type = f.feedback_type || (f.recommendation ? 'product' : 'bug')
    if (type !== activeType) return false
    if (!showReviewed && f.reviewed) return false
    return true
  })

  const unreadBugs = entries.filter(f => !(f.feedback_type === 'product' || f.recommendation) && !f.reviewed).length
  const unreadProduct = entries.filter(f => (f.feedback_type === 'product' || f.recommendation) && !f.reviewed).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Type tabs + reviewed toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {(['bug', 'product'] as const).map(t => {
          const unread = t === 'bug' ? unreadBugs : unreadProduct
          return (
            <button key={t} onClick={() => setActiveType(t)} style={{
              background: activeType === t ? '#1A1A14' : 'transparent',
              border: `1px solid ${activeType === t ? '#C8A96E' : '#252520'}`,
              borderRadius: 5, padding: '5px 14px', cursor: 'pointer',
              color: activeType === t ? '#C8A96E' : '#4A4A38', ...mono, fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {t === 'bug' ? '🐛 Bugs' : '💬 Product'}
              {unread > 0 && <span style={{ background: '#9A4A38', color: '#E8D0C8', borderRadius: 10, padding: '1px 6px', fontSize: 9 }}>{unread}</span>}
            </button>
          )
        })}
        <label style={{ ...mono, fontSize: 11, color: '#3A3A28', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showReviewed} onChange={e => setShowReviewed(e.target.checked)} />
          Show reviewed
        </label>
        <span style={{ ...mono, fontSize: 10, color: '#2A2A1E' }}>{filtered.length} shown</span>
      </div>

      {filtered.length === 0 && (
        <div style={{ color: '#2A2A20', ...mono, fontSize: 12, textAlign: 'center', padding: 40 }}>
          {showReviewed ? 'No feedback in this category.' : 'All caught up — no unreviewed feedback.'}
        </div>
      )}

      {filtered.map(f => {
        const session = Array.isArray(f.sessions) ? f.sessions[0] : f.sessions
        const snap = f.session_snapshot
        const ctx = f.error_context
        const resumeLink = f.session_id ? `https://pocketcmo.pro/?resume=${f.session_id}` : null
        const isExpanded = expandedId === f.id

        return (
          <div key={f.id} style={{
            ...card(),
            borderLeft: `3px solid ${f.reviewed ? '#1A1A14' : activeType === 'bug' ? '#9A4A38' : '#4A6A4A'}`,
            opacity: f.reviewed ? 0.6 : 1,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ ...mono, fontSize: 11, color: '#C8A96E' }}>
                    {snap?.business_name || session?.business_name || 'Anonymous'}
                  </span>
                  {(snap?.business_type || session?.business_type) && (
                    <span style={tag('#2A2A1E', '#0C0C09')}>{snap?.business_type || session?.business_type}</span>
                  )}
                  {f.category && (
                    <span style={tag('#1E2A1E', '#0A0C0A')}>{f.category}</span>
                  )}
                  {f.reviewed && <span style={tag('#1A2A1A', '#0A0C0A')}>✓ reviewed</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {f.user_email && (
                    <a href={`mailto:${f.user_email}`} style={{ ...mono, fontSize: 10, color: '#4A4A38', textDecoration: 'none' }}>
                      ✉ {f.user_email}
                    </a>
                  )}
                  {resumeLink && (
                    <a href={resumeLink} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10, color: '#4A4A38', textDecoration: 'none' }}>
                      ↗ resume link
                    </a>
                  )}
                  <span style={{ ...mono, fontSize: 9, color: '#2A2A1E' }}>
                    {new Date(f.created_at).toLocaleDateString()} {new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              {!f.reviewed && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : f.id)}
                  style={{
                    background: 'transparent', border: '1px solid #252520', borderRadius: 5,
                    padding: '4px 10px', cursor: 'pointer', color: '#5A5A48', ...mono, fontSize: 10,
                  }}
                >
                  {isExpanded ? 'Cancel' : 'Mark reviewed'}
                </button>
              )}
            </div>

            {/* Feedback text */}
            {f.recommendation && (
              <div style={{ color: '#2A2A1E', ...mono, fontSize: 10, marginBottom: 6, lineHeight: 1.4, fontStyle: 'italic' }}>
                re: "{f.recommendation.slice(0, 140)}{f.recommendation.length > 140 ? '…' : ''}"
              </div>
            )}
            <div style={{ color: '#C8C0B0', fontSize: 13, lineHeight: 1.7, fontFamily: 'Georgia, serif', marginBottom: 10 }}>
              "{f.feedback_text}"
            </div>

            {/* AI summary */}
            {f.ai_summary && (
              <div style={{
                background: '#0A0A08', border: '1px solid #1A1A12', borderRadius: 6,
                padding: '10px 12px', marginBottom: 10,
              }}>
                <div style={{ ...mono, fontSize: 9, color: '#3A3A28', letterSpacing: '0.1em', marginBottom: 6 }}>AI ANALYSIS</div>
                <div style={{ ...mono, fontSize: 11, color: '#7A7A60', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{f.ai_summary}</div>
              </div>
            )}

            {/* Session snapshot + technical context (collapsed) */}
            {(snap || ctx) && (
              <details style={{ marginBottom: 8 }}>
                <summary style={{ ...mono, fontSize: 10, color: '#3A3A28', cursor: 'pointer', marginBottom: 6 }}>
                  Session context ▾
                </summary>
                <div style={{ ...mono, fontSize: 10, color: '#4A4A38', lineHeight: 1.8, paddingLeft: 8 }}>
                  {snap && <>
                    <div>Progress: {snap.answered_count} questions answered</div>
                    {snap.completed_categories?.length > 0 && <div>Categories done: {snap.completed_categories.join(', ')}</div>}
                    {snap.status && <div>Status: {snap.status}</div>}
                    {snap.language && <div>Language: {snap.language}</div>}
                  </>}
                  {ctx?.currentQuestion && <div>Question at time: {ctx.currentQuestion}</div>}
                  {ctx?.phase && <div>Phase: {ctx.phase}</div>}
                  {ctx?.url && <div style={{ color: '#2A2A1E', wordBreak: 'break-all' }}>URL: {ctx.url}</div>}
                  {ctx?.conversationSnippet?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: '#2A2A1E', marginBottom: 4 }}>Last messages:</div>
                      {ctx.conversationSnippet.map((m: any, i: number) => (
                        <div key={i} style={{ color: m.role === 'user' ? '#6A6A50' : '#3A3A28', marginLeft: 8 }}>
                          [{m.role}] {String(m.content).slice(0, 120)}{String(m.content).length > 120 ? '…' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Resolution note if already reviewed */}
            {f.reviewed && f.resolution_note && (
              <div style={{ ...mono, fontSize: 10, color: '#4A6A4A', borderTop: '1px solid #1A1A14', paddingTop: 8 }}>
                Resolution: {f.resolution_note}
              </div>
            )}

            {/* Mark reviewed form */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #1A1A14', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  placeholder="Resolution note (optional) — what was fixed or communicated..."
                  value={resolutionInputs[f.id] || ''}
                  onChange={e => setResolutionInputs(prev => ({ ...prev, [f.id]: e.target.value }))}
                  rows={2}
                  style={{
                    background: '#0C0C09', border: '1px solid #1E1E14', borderRadius: 6,
                    padding: '8px 10px', color: '#D0C8B8', ...mono, fontSize: 11,
                    outline: 'none', resize: 'none', lineHeight: 1.5, width: '100%', boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={() => markReviewed(f.id)}
                  disabled={markingId === f.id}
                  style={{
                    alignSelf: 'flex-end', background: '#C8A96E', border: 'none', borderRadius: 5,
                    padding: '6px 16px', cursor: 'pointer', color: '#0C0C09', ...mono, fontSize: 11,
                  }}
                >
                  {markingId === f.id ? 'Saving...' : '✓ Mark reviewed'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Leads tab — product interest counts, email export, suggestion analysis ──────
type LeadRow = { product_key: string; email: string; created_at: string; business_name: string; completed: boolean }
type LeadsData = {
  summary: Record<string, { interested: number; not_interested: number }>
  uniqueInterestedEmails: number
  suggestions: { email: string | null; note: string; created_at: string; business_name: string }[]
  leads: LeadRow[]
}

function LeadsView({ dataMode }: { dataMode: 'real' | 'demo' }) {
  const [data, setData] = useState<LeadsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true); setAnalysis('')
    fetch(`/api/leads-summary?mode=${dataMode}`).then(r => r.json()).then(d => { if (active) { setData(d); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dataMode])

  const PRODUCTS = [
    { key: 'newsletter', label: 'Personalized briefing', accent: '#C8A96E' },
    { key: 'work_your_plan', label: 'Work your plan', accent: '#9A8A6A' },
  ]

  function emailsFor(productKey: string) {
    return [...new Set((data?.leads || []).filter(l => l.product_key === productKey).map(l => l.email))]
  }
  function completedCountFor(productKey: string) {
    return (data?.leads || []).filter(l => l.product_key === productKey && l.completed).length
  }
  async function copyEmails(productKey: string) {
    const list = emailsFor(productKey).join(', ')
    try { await navigator.clipboard.writeText(list); setCopied(productKey); setTimeout(() => setCopied(''), 1500) } catch { /* ignore */ }
  }
  function downloadCSV(productKey: string) {
    const rows = (data?.leads || []).filter(l => l.product_key === productKey)
    const csv = ['email,business,completed_interview,date', ...rows.map(r => `${r.email},"${(r.business_name || '').replace(/"/g, '""')}",${r.completed},${r.created_at.slice(0, 10)}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `leads_${productKey}_${dataMode}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  async function runAnalysis() {
    setAnalyzing(true)
    try {
      const r = await fetch('/api/analyze-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: dataMode }) })
      const d = await r.json()
      setAnalysis(d.analysis || d.error || 'No result.')
    } catch { setAnalysis('Analysis failed.') }
    setAnalyzing(false)
  }

  if (loading) return <div style={{ ...mono, fontSize: 12, color: '#3A3A28', padding: '40px 0', textAlign: 'center' }}>Loading leads…</div>

  const sg = data?.suggestions || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Env banner */}
      <div style={{ ...mono, fontSize: 11, color: dataMode === 'demo' ? '#E0905A' : '#7AAA7A' }}>
        {dataMode === 'demo'
          ? 'DEMO leads — curious / fictional-business visitors. Switch the header toggle to REAL for serious finalizers.'
          : 'REAL leads — people who ran their actual business. Toggle the header to DEMO for curious visitors.'}
      </div>

      {/* Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {[
          { lbl: 'NEWSLETTER', n: data?.summary?.newsletter?.interested ?? 0, sub: `${completedCountFor('newsletter')} completed interview`, accent: '#C8A96E' },
          { lbl: 'WORK YOUR PLAN', n: data?.summary?.work_your_plan?.interested ?? 0, sub: `${completedCountFor('work_your_plan')} completed interview`, accent: '#9A8A6A' },
          { lbl: 'SUGGESTIONS', n: data?.summary?.open_suggestions?.interested ?? 0, sub: 'free-text submitted', accent: '#7EB8A4' },
          { lbl: 'UNIQUE LEAD EMAILS', n: data?.uniqueInterestedEmails ?? 0, sub: 'deduped', accent: '#7AAA7A' },
        ].map(c => (
          <div key={c.lbl} style={card({ padding: '14px 16px' })}>
            <div style={{ color: c.accent, fontFamily: 'monospace', fontSize: 24, fontWeight: 300 }}>{c.n}</div>
            <div style={{ ...label(), fontSize: 9, marginTop: 4 }}>{c.lbl}</div>
            <div style={{ ...mono, fontSize: 9, color: '#3A3A28', marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Per-product email export */}
      {PRODUCTS.map(p => {
        const emails = emailsFor(p.key)
        return (
          <div key={p.key} style={card()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <SectionLabel>{`${p.label.toUpperCase()} — ${emails.length} EMAILS`}</SectionLabel>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button onClick={() => copyEmails(p.key)} disabled={emails.length === 0}
                  style={{ background: 'transparent', border: `1px solid ${p.accent}55`, borderRadius: 5, padding: '5px 11px', color: emails.length ? p.accent : '#3A3A28', ...mono, fontSize: 11, cursor: emails.length ? 'pointer' : 'default' }}>
                  {copied === p.key ? '✓ copied' : 'Copy emails'}
                </button>
                <button onClick={() => downloadCSV(p.key)} disabled={emails.length === 0}
                  style={{ background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 5, padding: '5px 11px', color: emails.length ? '#9A9080' : '#3A3A28', ...mono, fontSize: 11, cursor: emails.length ? 'pointer' : 'default' }}>
                  ⤓ CSV
                </button>
              </div>
            </div>
            {emails.length === 0
              ? <div style={{ ...mono, fontSize: 11, color: '#3A3A28' }}>No interest captured yet in this environment.</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(data?.leads || []).filter(l => l.product_key === p.key).map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, ...mono, fontSize: 11, color: '#C0B8A8' }}>
                      <span style={{ minWidth: 220 }}>{l.email}</span>
                      <span style={{ color: '#5A5440' }}>{l.business_name || '—'}</span>
                      {l.completed && <span style={{ color: '#7AAA7A', fontSize: 9, border: '1px solid #2A3A2A', borderRadius: 3, padding: '0 5px' }}>completed</span>}
                      <span style={{ marginLeft: 'auto', color: '#3A3A28', fontSize: 10 }}>{l.created_at.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )
      })}

      {/* Open suggestions + AI analysis */}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <SectionLabel>{`OPEN SUGGESTIONS — ${sg.length}`}</SectionLabel>
          <button onClick={runAnalysis} disabled={analyzing || sg.length === 0}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #7EB8A455', borderRadius: 5, padding: '5px 11px', color: sg.length ? '#7EB8A4' : '#3A3A28', ...mono, fontSize: 11, cursor: sg.length ? 'pointer' : 'default' }}>
            {analyzing ? 'Analyzing…' : '✦ Analyze with AI'}
          </button>
        </div>
        {analysis && (
          <div style={{ background: '#0C0C09', border: '1px solid #1A2A24', borderRadius: 6, padding: '14px 16px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, color: '#C0B8A8', whiteSpace: 'pre-wrap' }}>{analysis}</div>
        )}
        {sg.length === 0
          ? <div style={{ ...mono, fontSize: 11, color: '#3A3A28' }}>No suggestions yet.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sg.map((s, i) => (
                <div key={i} style={{ background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 12.5, color: '#C0B8A8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{s.note}</div>
                  <div style={{ ...mono, fontSize: 9, color: '#3A3A28', marginTop: 6 }}>{s.email || 'no email'} · {s.business_name || '—'} · {s.created_at.slice(0, 10)}</div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

// ── Main admin page ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [allSessions, setAllSessions] = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  // Real vs Demo data view. Demo = sessions tagged is_test (via ?test=1). Defaults to Real.
  const [dataMode, setDataMode] = useState<'real' | 'demo'>('real')
  // All downstream stats, buckets, lists and chat read this filtered view.
  const sessions = useMemo(
    () => allSessions.filter(s => dataMode === 'demo' ? !!s.is_test : !s.is_test),
    [allSessions, dataMode]
  )
  const [activeTab, setActiveTab] = useState<'funnel' | 'patterns' | 'clients' | 'leads' | 'feedback' | 'chat'>('funnel')
  const [search, setSearch] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminRole, setAdminRole] = useState<'full' | 'readonly'>('full')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'full' | 'readonly'>('readonly')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteStatus, setInviteStatus] = useState<{ ok?: boolean; error?: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUser(user ?? null)
      if (user?.email) {
        const { data: cache } = await supabase
          .from('admin_cache')
          .select('data')
          .eq('key', 'admin_emails')
          .single()
        // Support new {admins:[{email,role}]} format and old {emails:[]} format
        const admins: { email: string; role: 'full' | 'readonly' }[] =
          cache?.data?.admins ?? (cache?.data?.emails ?? [ADMIN_EMAIL]).map((e: string) => ({ email: e, role: 'full' }))
        const entry = admins.find(a => a.email === user.email)
          ?? (user.email === ADMIN_EMAIL ? { email: user.email, role: 'full' as const } : null)
        setIsAdmin(!!entry)
        setAdminRole(entry?.role ?? 'full')
      }
      setAuthLoading(false)
    })
  }, [])

  async function loadSessions() {
    setSessionsLoading(true)
    const { data } = await supabase
      .from('sessions')
      .select('id, business_name, business_type, industry, business_description, owner_tone, status, current_q_index, completed_summaries, admin_analysis, created_at, user_id, dashboard_cache, questions_completed, input_tokens, output_tokens, cost_usd, niche, employee_count, size_band, revenue_band, years_in_business, region, country, city, scores, is_test')
      .order('created_at', { ascending: false })
    setAllSessions(data || [])
    setSessionsLoading(false)
  }

  useEffect(() => {
    if (!isAdmin) return
    loadSessions()
  }, [isAdmin])

  if (authLoading) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12 }}>Loading...</span>
      </div>
    )
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    const { data, error } = await supabase.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: loginPassword,
    })
    if (error || data.user?.email !== ADMIN_EMAIL) {
      setLoginError('Incorrect password.')
      setLoginLoading(false)
      return
    }
    setUser(data.user)
    setIsAdmin(true)
    setAdminRole(data.user.email === ADMIN_EMAIL ? 'full' : 'full') // role confirmed via useEffect on mount
    setLoginLoading(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true)
    setInviteStatus(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const json = await res.json()
    if (json.error) {
      setInviteStatus({ error: json.error })
    } else {
      setInviteStatus({ ok: true })
      setInviteEmail('')
    }
    setInviteLoading(false)
  }

  if (!user || !isAdmin) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', marginBottom: 6 }}>POCKET CMO</div>
            <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.12em' }}>ADMIN</div>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              autoFocus
              style={{
                background: '#111110', border: '1px solid #1A1A14', borderRadius: 6,
                padding: '10px 14px', color: '#E8E0D0', fontFamily: 'monospace', fontSize: 13,
                outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
            />
            {loginError && (
              <div style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 11 }}>{loginError}</div>
            )}
            <button
              type="submit"
              disabled={loginLoading || !loginPassword}
              style={{
                background: '#1A1A14', border: '1px solid #2A2A20', borderRadius: 6,
                padding: '10px', color: loginLoading ? '#3A3A28' : '#C8A96E',
                fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.06em',
                cursor: loginLoading || !loginPassword ? 'default' : 'pointer',
              }}
            >
              {loginLoading ? 'Signing in...' : 'Sign in →'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const filteredSessions = sessions.filter(s =>
    !search || s.business_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.business_type?.toLowerCase().includes(search.toLowerCase()) ||
    s.industry?.toLowerCase().includes(search.toLowerCase())
  )

  const withData = sessions.filter(s => (s.completed_summaries || []).length > 0)

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'funnel', label: 'Funnel' },
    { key: 'patterns', label: 'Patterns' },
    { key: 'clients', label: `Clients (${sessions.length})` },
    { key: 'leads', label: 'Leads' },
    { key: 'feedback', label: 'Feedback' },
    { key: 'chat', label: 'Chat' },
  ]

  return (
    <div style={{ minHeight: '100dvh', background: '#0C0C09', fontFamily: 'Georgia, serif' }}>

      {/* Header */}
      <div style={{
        background: '#0F0F0B', borderBottom: '1px solid #1A1A14',
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <span style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.12em' }}>POCKET CMO</span>
        <span style={{ color: '#1E1E14', fontFamily: 'monospace', fontSize: 10 }}>·</span>
        <span style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.12em' }}>ADMIN</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Real / Demo data view toggle. Demo = sessions tagged is_test via ?test=1. */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid #1E1E14', borderRadius: 6, overflow: 'hidden' }}>
            {(['real', 'demo'] as const).map(m => (
              <button
                key={m}
                onClick={() => setDataMode(m)}
                style={{
                  background: dataMode === m ? (m === 'demo' ? '#2A1A0A' : '#1E1A10') : 'transparent',
                  border: 'none',
                  padding: '5px 12px',
                  color: dataMode === m ? (m === 'demo' ? '#E0905A' : '#C8A96E') : '#3A3A28',
                  fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.08em',
                  cursor: 'pointer',
                }}
              >
                {m === 'real' ? 'REAL' : 'DEMO'}
              </button>
            ))}
          </div>
          <span style={{ color: dataMode === 'demo' ? '#8A6A40' : '#2A2A20', fontFamily: 'monospace', fontSize: 10 }}>
            {withData.length} sessions with data{dataMode === 'demo' ? ' · demo' : ''}
          </span>

          {/* Invite admin — full admins only */}
          {adminRole === 'full' && <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setInviteOpen(o => !o); setInviteStatus(null) }}
              style={{
                color: inviteOpen ? '#C8A96E' : '#3A3A28', background: 'transparent', border: 'none',
                fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', padding: 0, letterSpacing: '0.06em',
              }}
            >
              + invite admin
            </button>
            {inviteOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 10px)', zIndex: 50,
                background: '#111110', border: '1px solid #1E1E14', borderRadius: 8,
                padding: '14px 16px', width: 280, boxShadow: '0 8px 24px #00000060',
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.12em', color: '#3A3A28', marginBottom: 10 }}>
                  INVITE ADMIN
                </div>
                <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="email"
                    placeholder="colleague@email.com"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    autoFocus
                    style={{
                      background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 5,
                      padding: '8px 10px', color: '#E8E0D0', fontFamily: 'monospace', fontSize: 12,
                      outline: 'none', width: '100%', boxSizing: 'border-box',
                    }}
                  />
                  {/* Role toggle */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['readonly', 'full'] as const).map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setInviteRole(r)}
                        style={{
                          flex: 1, background: inviteRole === r ? '#1E1A10' : '#0C0C09',
                          border: `1px solid ${inviteRole === r ? '#C8A96E50' : '#1A1A14'}`,
                          borderRadius: 5, padding: '6px 0',
                          color: inviteRole === r ? '#C8A96E' : '#3A3A28',
                          fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', letterSpacing: '0.04em',
                        }}
                      >
                        {r === 'readonly' ? 'Read only' : 'Full access'}
                      </button>
                    ))}
                  </div>
                  {inviteStatus?.error && (
                    <div style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 11 }}>{inviteStatus.error}</div>
                  )}
                  {inviteStatus?.ok && (
                    <div style={{ color: '#7EB8A4', fontFamily: 'monospace', fontSize: 11 }}>Invite sent ✓</div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="submit"
                      disabled={inviteLoading || !inviteEmail}
                      style={{
                        flex: 1, background: '#1A1A14', border: '1px solid #2A2A20', borderRadius: 5,
                        padding: '7px', color: inviteLoading || !inviteEmail ? '#3A3A28' : '#C8A96E',
                        fontFamily: 'monospace', fontSize: 11, cursor: inviteLoading || !inviteEmail ? 'default' : 'pointer',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {inviteLoading ? 'Sending...' : 'Send invite →'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteOpen(false)}
                      style={{
                        background: 'transparent', border: '1px solid #1A1A14', borderRadius: 5,
                        padding: '7px 10px', color: '#3A3A28', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>}

          <button
            onClick={async () => { await supabase.auth.signOut(); setUser(null); setIsAdmin(false) }}
            style={{
              color: '#2A2A20', background: 'transparent', border: 'none',
              fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', padding: 0,
            }}
            title="Sign out"
          >
            {user.email} · sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: '#0A0A07', borderBottom: '1px solid #111110', padding: '0 24px', display: 'flex', gap: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: 'transparent', border: 'none', borderBottom: `2px solid ${activeTab === t.key ? '#C8A96E' : 'transparent'}`,
              padding: '10px 16px', color: activeTab === t.key ? '#C8A96E' : '#3A3A28',
              fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer',
              transition: 'color 0.2s',
            }}
          >
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>

        {sessionsLoading ? (
          <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', padding: 40 }}>
            Loading client data...
          </div>
        ) : (
          <>
            {activeTab === 'funnel' && (
              <FunnelView sessions={sessions} dataMode={dataMode} />
            )}

            {activeTab === 'patterns' && (
              <CategoryBucketsView sessions={sessions} isFullAdmin={adminRole === 'full'} onReloadSessions={loadSessions} sessionsLoading={sessionsLoading} dataMode={dataMode} />
            )}

            {activeTab === 'clients' && (
              <div>
                <input
                  placeholder="Search clients..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    width: '100%', background: '#111110', border: '1px solid #1A1A14',
                    borderRadius: 6, padding: '10px 14px', color: '#E8E0D0',
                    fontFamily: 'monospace', fontSize: 13, outline: 'none',
                    marginBottom: 16, boxSizing: 'border-box',
                  }}
                />
                {filteredSessions.length === 0 ? (
                  <div style={{ color: '#2A2A20', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', padding: 40 }}>
                    No sessions found.
                  </div>
                ) : (
                  filteredSessions.map(s => (
                    <ClientCard key={s.id} session={s} adminEmail={user.email} allSessions={sessions} />
                  ))
                )}
              </div>
            )}

            {activeTab === 'leads' && (
              <LeadsView dataMode={dataMode} />
            )}

            {activeTab === 'feedback' && (
              <FeedbackView />
            )}

            {activeTab === 'chat' && (
              <ChatView sessions={sessions} adminEmail={user.email} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
