'use client'
import { useEffect, useState, useRef } from 'react'
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
}

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

function PatternsView({ sessions, adminEmail }: { sessions: Session[]; adminEmail: string }) {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [cacheLoading, setCacheLoading] = useState(true)
  const [fromCache, setFromCache] = useState(false)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Load cached patterns on mount
  useEffect(() => {
    supabase
      .from('admin_cache')
      .select('data, sessions_count, updated_at')
      .eq('key', 'patterns')
      .single()
      .then(({ data }) => {
        if (data?.data) {
          setResult(data.data)
          setFromCache(true)
          setCachedAt(data.updated_at)
        }
        setCacheLoading(false)
      })
  }, [])

  async function generate() {
    setLoading(true)
    setError('')
    setFromCache(false)
    const withData = sessions.filter(s => (s.completed_summaries || []).length > 0)
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'patterns', sessions, adminEmail }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }
    setResult(data.result)
    // Save to cache
    await supabase.from('admin_cache').upsert({
      key: 'patterns',
      data: data.result,
      sessions_count: withData.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    setCachedAt(new Date().toISOString())
    setLoading(false)
  }

  const withData = sessions.filter(s => (s.completed_summaries || []).length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={generate}
          disabled={loading || cacheLoading || withData.length === 0}
          style={{
            background: loading ? '#1A1A14' : '#C8A96E',
            border: 'none', borderRadius: 6, padding: '10px 20px',
            color: loading ? '#4A4A38' : '#0C0C09', ...mono, fontSize: 12,
            fontWeight: 500, cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Analysing...' : result ? '↺ Regenerate' : '▶ Generate analysis'}
        </button>
        <span style={{ ...mono, fontSize: 11, color: '#3A3A28' }}>
          {withData.length} sessions with data / {sessions.length} total
        </span>
        {fromCache && cachedAt && (
          <span style={{ ...mono, fontSize: 10, color: '#2A2A1E' }}>
            cached {new Date(cachedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {error && <div style={{ ...mono, fontSize: 12, color: '#C07050' }}>{error}</div>}

      {result && (
        <>
          {/* Meta observation */}
          {result.meta_observation && (
            <div style={card()}>
              <SectionLabel>META OBSERVATION</SectionLabel>
              <p style={{ color: '#C8A96E', fontSize: 14, lineHeight: 1.7, margin: 0, fontFamily: 'Georgia, serif' }}>
                {result.meta_observation}
              </p>
            </div>
          )}

          {/* Top pain points */}
          {result.top_pain_points?.length > 0 && (
            <div style={card()}>
              <SectionLabel>TOP PAIN POINTS</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.top_pain_points.map((p: any, i: number) => (
                  <div key={i} style={{ borderBottom: '1px solid #161612', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ color: '#D0C8B8', ...mono, fontSize: 13 }}>{p.issue}</span>
                      <span style={tag('#C8A96E', '#120E08')}>{p.count}×</span>
                    </div>
                    {p.examples?.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {p.examples.map((ex: string, j: number) => (
                          <li key={j} style={{ color: '#4A4A38', ...mono, fontSize: 11, paddingLeft: 12, position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 0 }}>·</span>{ex}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Behavioral patterns */}
          {result.behavioral_patterns?.length > 0 && (
            <div style={card()}>
              <SectionLabel>BEHAVIORAL PATTERNS</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.behavioral_patterns.map((p: any, i: number) => (
                  <div key={i} style={{ borderBottom: '1px solid #161612', paddingBottom: 12 }}>
                    <div style={{ color: '#C8A96E', ...mono, fontSize: 12, marginBottom: 4 }}>{p.pattern}</div>
                    <div style={{ color: '#7A7A5A', fontSize: 13, lineHeight: 1.6, marginBottom: 6, fontFamily: 'Georgia, serif' }}>{p.description}</div>
                    {p.examples?.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {p.examples.map((ex: string, j: number) => (
                          <li key={j} style={{ color: '#3A3A28', ...mono, fontSize: 11, paddingLeft: 12, position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 0 }}>·</span>{ex}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Knowledge gaps */}
            {result.knowledge_gaps?.length > 0 && (
              <div style={card()}>
                <SectionLabel>KNOWLEDGE GAPS</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.knowledge_gaps.map((g: any, i: number) => (
                    <div key={i}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ color: '#D0C8B8', ...mono, fontSize: 12 }}>{g.area}</span>
                        <span style={tag('#9A7A4A', '#100C06')}>{g.frequency}×</span>
                      </div>
                      <div style={{ color: '#3A3A28', ...mono, fontSize: 11, lineHeight: 1.5 }}>{g.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick wins */}
            {result.quick_wins?.length > 0 && (
              <div style={card()}>
                <SectionLabel>QUICK WIN OPPORTUNITIES</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.quick_wins.map((q: any, i: number) => {
                    const e = effortColor(q.effort)
                    const imp = effortColor(q.impact)
                    return (
                      <div key={i}>
                        <div style={{ color: '#D0C8B8', ...mono, fontSize: 12, marginBottom: 4 }}>{q.opportunity}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <span style={tag(e.color, e.bg)}>effort: {q.effort}</span>
                          <span style={tag(imp.color, imp.bg)}>impact: {q.impact}</span>
                          {q.applicable_to && <span style={tag('#5A5A48', '#101010')}>{q.applicable_to}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FunnelView({ sessions }: { sessions: Session[] }) {
  const total = sessions.length
  const anyActivity = sessions.filter(s => (s.current_q_index || 0) > 0).length
  const reachedQ6 = sessions.filter(s => (s.current_q_index || 0) >= 6).length
  const hasSummaries = sessions.filter(s => (s.completed_summaries || []).length > 0).length
  const completed = sessions.filter(s => s.status === 'completed').length
  const authenticated = sessions.filter(s => s.user_id != null).length
  const anonymous = sessions.filter(s => s.user_id == null).length

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
        ].map(({ label: lbl, value }) => (
          <div key={lbl} style={card({ textAlign: 'center', padding: '14px 12px' })}>
            <div style={{ color: '#D0C8B8', fontFamily: 'monospace', fontSize: 22, fontWeight: 300, marginBottom: 4 }}>{value}</div>
            <div style={{ ...label(), fontSize: 9 }}>{lbl}</div>
          </div>
        ))}
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

function ClientCard({ session, adminEmail, allSessions }: { session: Session; adminEmail: string; allSessions: Session[] }) {
  const [expanded, setExpanded] = useState(false)
  const [analysis, setAnalysis] = useState<any>(session.admin_analysis || null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [rawResponses, setRawResponses] = useState<RawResponse[] | null>(null)
  const [rawLoading, setRawLoading] = useState(false)

  const summaryCount = (session.completed_summaries || []).length
  const pct = session.current_q_index ? Math.round((session.current_q_index / 35) * 100) : 0
  const isAnon = session.user_id == null
  const hasActivity = (session.current_q_index || 0) > 0

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
        <span style={tag(session.status === 'completed' ? '#7AAA7A' : '#8A6A30', session.status === 'completed' ? '#0A120A' : '#120E08')}>
          {session.status}
        </span>
        <span style={{ ...mono, fontSize: 10, color: '#3A3A28' }}>{summaryCount} topics</span>
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

          {/* Summaries */}
          {summaryCount > 0 && (
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
    'What are the most common problems across all clients?',
    'Which clients are furthest along in their interview?',
    'Where are clients most likely flying blind with no data?',
    'What patterns do you see in how owners talk about pricing?',
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
              padding: '12px 16px', color: '#D0C8B8', fontSize: 14,
              lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: msg.role === 'user' ? 'monospace' : 'Georgia, serif',
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

  useEffect(() => {
    supabase
      .from('feedback')
      .select('id, category, recommendation, feedback_text, created_at, sessions(business_name, business_type, industry)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('FeedbackView:', error.message)
        setEntries(data || [])
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div style={{ color: '#3A3A28', ...mono, fontSize: 12, textAlign: 'center', padding: 40 }}>Loading feedback...</div>
  }

  if (entries.length === 0) {
    return <div style={{ color: '#2A2A20', ...mono, fontSize: 12, textAlign: 'center', padding: 40 }}>No feedback submitted yet.</div>
  }

  // Group by category
  const grouped = entries.reduce((acc, f) => {
    const key = f.category || 'Uncategorized'
    if (!acc[key]) acc[key] = []
    acc[key].push(f)
    return acc
  }, {} as Record<string, any[]>)

  const sortedAreas = Object.entries(grouped).sort(([, a], [, b]) => (b as any[]).length - (a as any[]).length)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...mono, fontSize: 11, color: '#3A3A28' }}>
        {entries.length} entries · {sortedAreas.length} areas
      </div>

      {sortedAreas.map(([area, rawItems]) => {
        const items = rawItems as any[]
        return (
        <div key={area} style={card()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ ...label(), flex: 1 }}>{area.toUpperCase()}</div>
            <span style={tag('#C8A96E', '#120E08')}>{items.length}×</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(items as any[]).map((f) => {
              const session = Array.isArray(f.sessions) ? f.sessions[0] : f.sessions
              return (
                <div key={f.id} style={{ borderLeft: '2px solid #1A1A14', paddingLeft: 12 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: 10, color: '#4A4A38' }}>
                      {session?.business_name || 'Anonymous'}
                    </span>
                    {session?.business_type && (
                      <span style={{ ...mono, fontSize: 9, color: '#2A2A20' }}>{session.business_type}</span>
                    )}
                    <span style={{ ...mono, fontSize: 9, color: '#2A2A20', marginLeft: 'auto' }}>
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {f.recommendation && (
                    <div style={{ color: '#2A2A1E', ...mono, fontSize: 10, marginBottom: 5, lineHeight: 1.4 }}>
                      re: {f.recommendation.slice(0, 120)}{f.recommendation.length > 120 ? '…' : ''}
                    </div>
                  )}
                  <div style={{ color: '#9A9080', fontSize: 13, lineHeight: 1.6, fontFamily: 'Georgia, serif' }}>
                    {f.feedback_text}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )
      })}
    </div>
  )
}

// ── Main admin page ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'funnel' | 'patterns' | 'clients' | 'feedback' | 'chat'>('funnel')
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null)
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) return
    setSessionsLoading(true)
    supabase
      .from('sessions')
      .select('id, business_name, business_type, industry, business_description, owner_tone, status, current_q_index, completed_summaries, admin_analysis, created_at, user_id')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSessions(data || [])
        setSessionsLoading(false)
      })
  }, [user])

  if (authLoading) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12 }}>Loading...</span>
      </div>
    )
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12 }}>Access denied.</span>
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
          <span style={{ color: '#2A2A20', fontFamily: 'monospace', fontSize: 10 }}>
            {withData.length} sessions with data
          </span>
          <span style={{
            color: '#4A6A4A', background: '#101410', border: '1px solid #1A2A1A',
            borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace', fontSize: 10,
          }}>
            {user.email}
          </span>
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
              <FunnelView sessions={sessions} />
            )}

            {activeTab === 'patterns' && (
              <PatternsView sessions={sessions} adminEmail={user.email} />
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
