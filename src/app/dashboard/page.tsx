'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'

function FeedbackWidget({ sessionId, category, recommendation }: { sessionId: string; category: string; recommendation: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!text.trim()) return
    setLoading(true)
    await supabase.from('feedback').insert({
      session_id: sessionId,
      category,
      recommendation,
      feedback_text: text.trim(),
    })
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return <div style={{ color: '#4A6A4A', fontFamily: 'monospace', fontSize: 10, marginTop: 10 }}>Feedback received.</div>
  }

  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button
          onClick={e => { e.stopPropagation(); setOpen(true) }}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: '#2A2A20', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.08em',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#4A4A38')}
          onMouseLeave={e => (e.currentTarget.style.color = '#2A2A20')}
        >
          + LEAVE FEEDBACK
        </button>
      ) : (
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Is this recommendation accurate? Anything we missed?"
            rows={3}
            autoFocus
            style={{
              background: '#0C0C09', border: '1px solid #1E1E14', borderRadius: 6,
              padding: '8px 10px', color: '#D0C8B8', fontFamily: 'monospace',
              fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5,
              width: '100%', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={submit}
              disabled={!text.trim() || loading}
              style={{
                background: !text.trim() || loading ? '#1A1A14' : '#C8A96E',
                border: 'none', borderRadius: 5, padding: '6px 14px',
                color: !text.trim() || loading ? '#3A3A28' : '#0C0C09',
                fontFamily: 'monospace', fontSize: 11,
                cursor: !text.trim() || loading ? 'default' : 'pointer',
              }}
            >
              {loading ? 'Saving...' : 'Submit'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: '#2A2A20', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type CategoryInsight = {
  category: string
  confidence: number
  confidence_label: 'No data' | 'Early signals' | 'Good basis' | 'Strong data'
  situation: string
  recommendation: string
  data_gaps: string[]
}

function confidenceBarColor(score: number): string {
  if (score <= 25) return '#2A2A20'
  if (score <= 50) return '#7A5A20'
  if (score <= 75) return '#C8A96E'
  return '#6A9A6A'
}

function confidenceBorderColor(score: number): string {
  if (score <= 25) return '#1A1A14'
  if (score <= 50) return 'rgba(122,90,32,0.3)'
  if (score <= 75) return 'rgba(200,169,110,0.25)'
  return 'rgba(106,154,106,0.3)'
}

function confidenceLabelColor(score: number): string {
  if (score <= 25) return '#3A3A28'
  if (score <= 50) return '#8A6A30'
  if (score <= 75) return '#C8A96E'
  return '#7AAA7A'
}

function DashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams.get('session')

  const [categories, setCategories] = useState<CategoryInsight[]>([])
  const [emergingPicture, setEmergingPicture] = useState<string | null>(null)
  const [completedSummaries, setCompletedSummaries] = useState<{ question: string; summary: string; data_backed?: boolean | null }[]>([])
  const [categoryQuestionsMap, setCategoryQuestionsMap] = useState<Map<string, string[]>>(new Map())
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('Loading your session...')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) { setError('No session ID in URL.'); setLoading(false); return }
    loadDashboard(sessionId)
  }, [sessionId])

  async function loadDashboard(sid: string) {
    setLoading(true)
    setLoadingMessage('Loading your session...')

    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sid)
      .single()

    if (sessionErr || !session) {
      setError('Session not found. Make sure you\'re signed in.')
      setLoading(false)
      return
    }

    setBusinessName(session.business_name || '')

    const completedSummaries: { question: string; summary: string; data_backed?: boolean | null }[] = session.completed_summaries || []
    setCompletedSummaries(completedSummaries)
    const summaryCount = completedSummaries.length

    // Serve from cache if summaries haven't changed since last generation
    if (session.dashboard_cache && session.dashboard_cache_count === summaryCount) {
      // Cache may be old array shape or new object shape
      const cache = session.dashboard_cache
      if (Array.isArray(cache)) {
        setCategories(cache)
      } else {
        setCategories(cache.categories || [])
        setEmergingPicture(cache.emerging_picture || null)
      }
      setLoading(false)
      return
    }

    setLoadingMessage('Loading question bank...')

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('id, category, core_question, applies_to')
      .order('sort_order')

    if (qErr || !questions || questions.length === 0) {
      setError('Could not load questions. Try refreshing.')
      setLoading(false)
      return
    }

    const businessType = session.business_type || ''
    const filtered = questions.filter((q: any) => {
      if (!q.applies_to || q.applies_to.length === 0) return true
      if (!businessType) return true
      return q.applies_to.includes(businessType) || q.applies_to.includes('all')
    })

    const categoryOrder: string[] = []
    const categoryQuestions = new Map<string, string[]>()
    filtered.forEach((q: any) => {
      if (!q.category) return
      if (!categoryQuestions.has(q.category)) {
        categoryQuestions.set(q.category, [])
        categoryOrder.push(q.category)
      }
      categoryQuestions.get(q.category)!.push(q.core_question)
    })
    setCategoryQuestionsMap(categoryQuestions)

    const summaryMap = new Map(completedSummaries.map(s => [s.question, { summary: s.summary, data_backed: s.data_backed ?? null }]))
    const categoryData = categoryOrder.map(cat => {
      const qs = categoryQuestions.get(cat) || []
      return {
        name: cat,
        covered: qs.filter(q => summaryMap.has(q)).map(q => ({
          question: q,
          summary: summaryMap.get(q)!.summary,
          data_backed: summaryMap.get(q)!.data_backed,
        })),
        uncovered: qs.filter(q => !summaryMap.has(q)),
      }
    })

    setLoadingMessage('Analysing your data...')

    const res = await fetch('/api/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: session.business_name,
        businessType: session.business_type,
        industry: session.industry,
        businessDescription: session.business_description,
        ownerTone: session.owner_tone,
        categoryData,
      }),
    })

    if (!res.ok) {
      setError('Analysis failed. Try again.')
      setLoading(false)
      return
    }

    const data = await res.json()
    const freshCategories = data.categories || []
    const freshSummary = data.emerging_picture || null
    setCategories(freshCategories)
    setEmergingPicture(freshSummary)

    // Save to cache as new shape {emerging_picture, categories}
    await supabase.from('sessions').update({
      dashboard_cache: { emerging_picture: freshSummary, categories: freshCategories },
      dashboard_cache_count: summaryCount,
    }).eq('id', sid)

    setLoading(false)
  }

  const coveredCount = categories.filter(c => c.confidence > 0).length

  if (loading) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#0C0C09',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10,
      }}>
        <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 13 }}>{loadingMessage}</div>
        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 11 }}>Building confidence scores across all areas</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#0C0C09',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#111110', border: '1px solid #222218', borderRadius: 12,
          padding: '28px', maxWidth: 380, textAlign: 'center',
        }}>
          <div style={{ color: '#9A7050', fontFamily: 'monospace', fontSize: 13, marginBottom: 16 }}>{error}</div>
          <button
            onClick={() => { sessionStorage.setItem('autoResume', 'true'); router.push('/') }}
            style={{
              background: '#C8A96E', border: 'none', borderRadius: 6,
              padding: '10px 20px', color: '#0C0C09', fontFamily: 'monospace',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0C0C09', fontFamily: 'Georgia, serif' }}>

      {/* Header */}
      <div style={{
        background: '#0F0F0B', borderBottom: '1px solid #1A1A14',
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => {
            sessionStorage.setItem('autoResume', 'true')
            router.push('/')
          }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#4A4A38', fontFamily: 'monospace', fontSize: 12,
            padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#C8A96E')}
          onMouseLeave={e => (e.currentTarget.style.color = '#4A4A38')}
        >
          ← Interview
        </button>
        <div style={{ width: 1, height: 14, background: '#1E1E14' }} />
        <span style={{ color: '#6A6A52', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.12em' }}>OVERVIEW</span>
        {businessName && (
          <span style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 12 }}>{businessName}</span>
        )}
        <div style={{ marginLeft: 'auto', color: '#3A3A28', fontFamily: 'monospace', fontSize: 10 }}>
          {coveredCount} of {categories.length} areas covered
        </div>
      </div>

      {/* Grid */}
      <div style={{ padding: '24px 20px', maxWidth: 1100, margin: '0 auto' }}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ color: '#E8E0D0', fontSize: 18, fontWeight: 400, margin: '0 0 6px' }}>Diagnostic Overview</h1>
          <p style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 11, margin: 0, lineHeight: 1.6 }}>
            Confidence scores reflect how much data has actually been collected — not an evaluation of your business. Go deeper in the interview to raise them.
          </p>
        </div>

        {emergingPicture && (
          <div style={{
            background: '#0F0F0A',
            border: '1px solid rgba(200,169,110,0.15)',
            borderLeft: '3px solid rgba(200,169,110,0.4)',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 20,
          }}>
            <div style={{
              fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.12em',
              color: '#5A5040', marginBottom: 8,
            }}>
              EARLY PICTURE — INCOMPLETE
            </div>
            <p style={{ color: '#B8A880', fontSize: 14, lineHeight: 1.7, margin: 0, fontFamily: 'Georgia, serif' }}>
              {emergingPicture}
            </p>
          </div>
        )}

        {categories.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            color: '#3A3A28', fontFamily: 'monospace', fontSize: 12,
          }}>
            No interview data found for this session.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 12,
          }}>
            {categories.map(cat => {
              const isExpanded = expanded === cat.category
              const barColor = confidenceBarColor(cat.confidence)
              const borderColor = confidenceBorderColor(cat.confidence)
              const labelColor = confidenceLabelColor(cat.confidence)
              const hasGaps = cat.data_gaps && cat.data_gaps.length > 0

              // Data-backed indicator: count tagged summaries for this category
              const catQuestions = categoryQuestionsMap.get(cat.category) || []
              const catSummaries = completedSummaries.filter(s => catQuestions.includes(s.question))
              const taggedSummaries = catSummaries.filter(s => s.data_backed !== null && s.data_backed !== undefined)
              const dataBackedCount = taggedSummaries.filter(s => s.data_backed === true).length
              const gutCount = taggedSummaries.filter(s => s.data_backed === false).length

              return (
                <div
                  key={cat.category}
                  onClick={() => setExpanded(isExpanded ? null : cat.category)}
                  style={{
                    background: '#111110',
                    border: `1px solid ${isExpanded ? borderColor : '#1A1A14'}`,
                    borderRadius: 10, padding: '16px', cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => {
                    if (!isExpanded) (e.currentTarget as HTMLDivElement).style.borderColor = borderColor
                  }}
                  onMouseLeave={e => {
                    if (!isExpanded) (e.currentTarget as HTMLDivElement).style.borderColor = '#1A1A14'
                  }}
                >
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ color: '#D0C8B8', fontSize: 13, fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                      {cat.category}
                    </span>
                    <span style={{
                      fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em',
                      color: labelColor, background: '#0C0C09',
                      border: `1px solid ${borderColor}`, borderRadius: 3,
                      padding: '2px 7px',
                    }}>
                      {cat.confidence_label.toUpperCase()}
                    </span>
                  </div>

                  {/* Confidence bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#2A2A20', fontFamily: 'monospace', fontSize: 9 }}>CONFIDENCE</span>
                      <span style={{ color: labelColor, fontFamily: 'monospace', fontSize: 9 }}>{cat.confidence}%</span>
                    </div>
                    <div style={{ height: 3, background: '#1A1A14', borderRadius: 2 }}>
                      <div style={{
                        width: `${cat.confidence}%`, height: '100%',
                        background: barColor, borderRadius: 2,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>

                  {/* Expand toggle */}
                  <div style={{
                    color: '#2A2A20', fontFamily: 'monospace', fontSize: 9,
                    letterSpacing: '0.06em',
                  }}>
                    {isExpanded ? '▲ COLLAPSE' : '▼ DETAILS'}
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ height: 1, background: '#1A1A14' }} />

                      {/* Evidence indicator */}
                      {taggedSummaries.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ color: '#2A2A20', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em' }}>EVIDENCE</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {Array.from({ length: dataBackedCount }).map((_, i) => (
                              <span key={`d${i}`} style={{ width: 8, height: 8, borderRadius: '50%', background: '#4A7A4A', display: 'inline-block' }} title="Data-backed" />
                            ))}
                            {Array.from({ length: gutCount }).map((_, i) => (
                              <span key={`g${i}`} style={{ width: 8, height: 8, borderRadius: '50%', background: '#7A5A28', display: 'inline-block' }} title="Gut feel" />
                            ))}
                          </div>
                          <span style={{ color: '#2A2A20', fontFamily: 'monospace', fontSize: 9 }}>
                            {dataBackedCount > 0 && `${dataBackedCount} confirmed`}
                            {dataBackedCount > 0 && gutCount > 0 && ' · '}
                            {gutCount > 0 && `${gutCount} estimated`}
                          </span>
                        </div>
                      )}

                      <div>
                        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', marginBottom: 6 }}>
                          CURRENT SITUATION
                        </div>
                        <p style={{ color: '#9A9080', fontSize: 13, lineHeight: 1.65, margin: 0 }}>
                          {cat.situation}
                        </p>
                      </div>

                      <div>
                        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', marginBottom: 6 }}>
                          RECOMMENDATION
                        </div>
                        <p style={{
                          color: cat.confidence > 50 ? '#C8A96E' : '#5A5040',
                          fontSize: 13, lineHeight: 1.65, margin: 0,
                        }}>
                          {cat.recommendation}
                        </p>
                        {sessionId && (
                          <FeedbackWidget
                            sessionId={sessionId}
                            category={cat.category}
                            recommendation={cat.recommendation}
                          />
                        )}
                      </div>

                      {hasGaps && (
                        <div>
                          <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', marginBottom: 6 }}>
                            DATA GAPS
                          </div>
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {cat.data_gaps.map((gap, i) => (
                              <li key={i} style={{
                                color: '#4A4A38', fontFamily: 'monospace', fontSize: 11,
                                paddingLeft: 12, position: 'relative',
                              }}>
                                <span style={{ position: 'absolute', left: 0, color: '#2A2A20' }}>·</span>
                                {gap}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100dvh', background: '#0C0C09',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12 }}>Loading...</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
