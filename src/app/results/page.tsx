'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

type AreaScore = {
  category: string
  score: number
  label: string
  insight: string
  opportunity: string
}

type QuickWin = {
  title: string
  desc: string
  effort: number
  impact: number
}

type BigBet = {
  title: string
  desc: string
  mvp: string
}

type Report = {
  summary: string
  areas: AreaScore[]
  quickWins: QuickWin[]
  bigBets: BigBet[]
}

const scoreColor = (s: number) => {
  if (s <= 2) return '#E07B5A'
  if (s === 3) return '#C8C85A'
  return '#7EB8A4'
}

const scoreLabel = (s: number) => {
  if (s <= 1) return 'Critical'
  if (s === 2) return 'Weak'
  if (s === 3) return 'Moderate'
  if (s === 4) return 'Good'
  return 'Strong'
}

function ScoreBar({ score }: { score: number }) {
  const color = scoreColor(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: '#1A1A14', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${(score / 5) * 100}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 1s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color, width: 52 }}>{scoreLabel(score)}</span>
    </div>
  )
}

function ResultsContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')
  const [report, setReport] = useState<Report | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openArea, setOpenArea] = useState<number | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID found.')
      setLoading(false)
      return
    }
    generateReport()
  }, [sessionId])

  async function generateReport() {
    // Load session
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session) {
      setError('Session not found.')
      setLoading(false)
      return
    }

    setBusinessName(session.business_name)

    // Load all responses with question text
    const { data: responses } = await supabase
      .from('responses')
      .select('*, questions(core_question)')
      .eq('session_id', sessionId)

    if (!responses || responses.length === 0) {
      setError('No responses found for this session.')
      setLoading(false)
      return
    }

    const formatted = responses.map((r: any) => ({
      question: r.questions?.core_question || 'Unknown question',
      conversation: r.conversation || [],
    }))

    // Generate report via Claude
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: session.business_name, responses: formatted }),
    })

    const { report: generated, error: apiError } = await res.json()

    if (apiError) {
      setError('Failed to generate report.')
      setLoading(false)
      return
    }

    setReport(generated)
    setLoading(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 13, marginBottom: 12 }}>Analysing your interview...</div>
        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 11 }}>This takes about 10 seconds</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 13 }}>{error}</div>
    </div>
  )

  if (!report) return null

  const criticalCount = report.areas.filter(a => a.score <= 2).length

  return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', fontFamily: 'Georgia, serif', color: '#E8E0D0' }}>
      {/* Header */}
      <div style={{ background: '#0F0F0B', borderBottom: '1px solid #1A1A14', padding: '20px 32px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 6 }}>DIAGNOSTIC REPORT</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h1 style={{ fontSize: 26, fontWeight: 400, margin: 0 }}>{businessName}</h1>
            <div style={{ display: 'flex', gap: 20 }}>
              {[
                ['Areas Reviewed', report.areas.length, '#C8A96E'],
                ['Critical Gaps', criticalCount, '#E07B5A'],
                ['Quick Wins', report.quickWins.length, '#7EB8A4'],
              ].map(([l, v, c]) => (
                <div key={String(l)} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, color: String(c), fontFamily: 'Georgia, serif' }}>{v}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#3A3A28', fontFamily: 'monospace' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px' }}>

        {/* Summary */}
        <div style={{ background: '#111110', border: '1px solid #1E1E14', borderRadius: 10, padding: '20px 24px', marginBottom: 28 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 10 }}>OVERVIEW</div>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#C0B8A8', margin: 0 }}>{report.summary}</p>
        </div>

        {/* Area scores */}
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 14 }}>AREA BREAKDOWN</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 32 }}>
          {report.areas.sort((a, b) => a.score - b.score).map((area, i) => (
            <div key={i} onClick={() => setOpenArea(openArea === i ? null : i)} style={{
              background: '#111110', border: `1px solid ${openArea === i ? '#252520' : '#1A1A14'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer', transition: 'border 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: '#D0C8B8', flex: 1 }}>{area.category}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: scoreColor(area.score) }}>{area.label}</span>
              </div>
              <ScoreBar score={area.score} />
              {openArea === i && (
                <div style={{ marginTop: 16, borderTop: '1px solid #1E1E14', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 6 }}>FINDING</div>
                    <p style={{ fontSize: 13, color: '#908870', fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>{area.insight}</p>
                  </div>
                  <div style={{ background: '#141410', border: '1px solid #7EB8A428', borderRadius: 6, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#7EB8A4', fontFamily: 'monospace', marginBottom: 6 }}>▸ OPPORTUNITY</div>
                    <p style={{ fontSize: 13, color: '#708870', fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>{area.opportunity}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Quick wins */}
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 14 }}>QUICK WINS — Do These First</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginBottom: 32 }}>
          {report.quickWins.map((w, i) => (
            <div key={i} style={{ background: '#111110', border: '1px solid #1A1A14', borderRadius: 8, padding: '16px 18px' }}>
              <div style={{ fontSize: 14, color: '#D0C8B8', marginBottom: 8 }}>{w.title}</div>
              <p style={{ fontSize: 12, color: '#706850', fontFamily: 'monospace', lineHeight: 1.6, margin: '0 0 12px' }}>{w.desc}</p>
              <div style={{ display: 'flex', gap: 14 }}>
                {[['Effort', w.effort, '#E07B5A'], ['Impact', w.impact, '#7EB8A4']].map(([l, v, c]) => (
                  <div key={String(l)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#3A3A28' }}>{l}</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[1,2,3].map(n => (
                        <div key={n} style={{ width: 6, height: 6, borderRadius: '50%', background: n <= Number(v) ? String(c) : '#1E1E14' }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Big bets */}
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 14 }}>BIG BETS — Validate Before Building</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {report.bigBets.map((b, i) => (
            <div key={i} style={{ background: '#111110', border: '1px solid #1A1A14', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: 15, color: '#D0C8B8', marginBottom: 6 }}>{b.title}</div>
              <p style={{ fontSize: 13, color: '#706850', fontFamily: 'monospace', lineHeight: 1.6, margin: '0 0 12px' }}>{b.desc}</p>
              <div style={{ background: '#141410', border: '1px solid #C8A96E28', borderRadius: 5, padding: '10px 12px' }}>
                <span style={{ fontSize: 10, letterSpacing: '0.1em', color: '#C8A96E', fontFamily: 'monospace' }}>⚑ MVP PATH  </span>
                <span style={{ fontSize: 12, color: '#807050', fontFamily: 'monospace' }}>{b.mvp}</span>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 13 }}>Loading...</div>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  )
}