'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import FeedbackButton from '@/components/FeedbackButton'
import ClientNav from '@/components/ClientNav'
import { ensureReport } from '@/lib/report'

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
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [openArea, setOpenArea] = useState<number | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  const printMode = searchParams.get('print') === '1'

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID found.')
      setLoading(false)
      return
    }
    ensureReport(sessionId).then(res => {
      if (res.error) setError(res.error)
      else { setReport(res.report ?? null); setBusinessName(res.businessName || '') }
      setLoading(false)
    })
  }, [sessionId])

  // When arriving with ?print=1 (the hub's "Download PDF"), expand everything
  // and open the browser print dialog so the user can save as PDF.
  useEffect(() => {
    if (printMode && report && !loading) {
      setExpandAll(true)
      const t = setTimeout(() => window.print(), 600)
      return () => clearTimeout(t)
    }
  }, [printMode, report, loading])

  function downloadPdf() {
    setExpandAll(true)
    setTimeout(() => window.print(), 300)
  }

  async function handleRegenerate() {
    if (regenerating || !sessionId) return
    setRegenerating(true)
    const res = await ensureReport(sessionId, { force: true })
    if (res.error) setError(res.error)
    else { setReport(res.report ?? null); setBusinessName(res.businessName || '') }
    setRegenerating(false)
  }

  if (loading) return (
    <>
      <style>{`
        @keyframes cmo-slide {
          0%   { left: -45%; width: 45%; }
          60%  { width: 45%; }
          100% { left: 145%; width: 45%; }
        }
        @keyframes cmo-dot {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1); }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', marginBottom: 28 }}>
          DIAGNOSTIC REPORT
        </div>
        <div style={{ width: 180, height: 2, background: '#1A1A14', borderRadius: 1, position: 'relative', overflow: 'hidden', marginBottom: 28 }}>
          <div style={{
            position: 'absolute', top: 0, height: '100%',
            background: 'linear-gradient(90deg, transparent, #C8A96E, transparent)',
            borderRadius: 1, animation: 'cmo-slide 1.8s ease-in-out infinite',
          }} />
        </div>
        <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.04em', marginBottom: 16 }}>
          Building your report
        </div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 28 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#4A4A38',
              animation: `cmo-dot 1.4s ease-in-out ${i * 0.22}s infinite`,
            }} />
          ))}
        </div>
        <div style={{ color: '#2A2A1E', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em' }}>
          Analyzing your answers…
        </div>
        <FeedbackButton sessionId={sessionId} context={{ phase: 'report_loading' }} />
      </div>
    </>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 13 }}>{error}</div>
      <FeedbackButton sessionId={sessionId} context={{ phase: 'report_error', error }} />
    </div>
  )

  if (!report) return null

  const areas = report.areas ?? []
  const quickWins = report.quickWins ?? []
  const bigBets = report.bigBets ?? []
  const criticalCount = areas.filter(a => a.score <= 2).length

  return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', fontFamily: 'Georgia, serif', color: '#E8E0D0' }}>
      {/* Keep the dark theme when saving to PDF; hide interactive controls. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #0C0C09 !important; }
        }
      `}</style>
      {/* Shared client nav (hidden when printing to PDF) */}
      <div className="no-print">
        <ClientNav
          sessionId={sessionId}
          active="results"
          businessName={businessName}
          actions={
            <>
              <button
                onClick={downloadPdf}
                title="Download this report as a PDF"
                style={{
                  background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 6,
                  padding: '5px 12px', color: '#6A6450', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer',
                }}
              >⤓ Download PDF</button>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                title="Regenerate this report from the interview data"
                style={{
                  background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 6,
                  padding: '5px 12px', color: regenerating ? '#3A3A28' : '#6A6450',
                  fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em',
                  cursor: regenerating ? 'default' : 'pointer',
                }}
              >
                {regenerating ? 'Regenerating…' : '↻ Regenerate'}
              </button>
            </>
          }
        />
      </div>
      {/* Report document header */}
      <div style={{ background: '#0F0F0B', borderBottom: '1px solid #1A1A14', padding: '20px 32px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 6 }}>DIAGNOSTIC REPORT</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h1 style={{ fontSize: 26, fontWeight: 400, margin: 0 }}>{businessName}</h1>
            <div style={{ display: 'flex', gap: 20 }}>
              {[
                ['Areas Reviewed', areas.length, '#C8A96E'],
                ['Critical Gaps', criticalCount, '#E07B5A'],
                ['Quick Wins', quickWins.length, '#7EB8A4'],
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
          {areas.sort((a, b) => a.score - b.score).map((area, i) => (
            <div key={i} onClick={() => setOpenArea(openArea === i ? null : i)} style={{
              background: '#111110', border: `1px solid ${openArea === i ? '#252520' : '#1A1A14'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer', transition: 'border 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: '#D0C8B8', flex: 1 }}>{area.category}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: scoreColor(area.score) }}>{area.label}</span>
              </div>
              <ScoreBar score={area.score} />
              {(openArea === i || expandAll) && (
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
          {quickWins.map((w, i) => (
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
          {bigBets.map((b, i) => (
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
      <div className="no-print">
        <FeedbackButton sessionId={sessionId} context={{ phase: 'report_complete' }} />
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