'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ensureReport } from '@/lib/report'
import ClientNav from '@/components/ClientNav'

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']

type ModuleDef = {
  key: string
  label: string
  title: string
  desc: string
  accent: string
  available: boolean
  primary?: { text: string; href: string }
  secondary?: { text: string; href: string }
  badge?: string
}

function HubContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams.get('session')

  const [businessName, setBusinessName] = useState('')
  const [reportReady, setReportReady] = useState(false)
  const [pillarsCovered, setPillarsCovered] = useState(0)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId) { setError('No session ID.'); setLoading(false); return }
    load()
  }, [sessionId])

  async function load() {
    const { data: session } = await supabase
      .from('sessions')
      .select('business_name, status, report, dashboard_cache')
      .eq('id', sessionId!)
      .single()
    if (!session) { setError('Session not found.'); setLoading(false); return }
    setBusinessName(session.business_name || '')
    if (session.dashboard_cache?.v === 2) {
      setPillarsCovered(Object.keys(session.dashboard_cache?.pillars || {}).length)
    }

    // Generate the report once on first arrival, so the hub lands with it ready.
    if (session.report) {
      setReportReady(true)
    } else if (session.status === 'interview_done' || session.status === 'completed') {
      setBuilding(true)
      const res = await ensureReport(sessionId!)
      setReportReady(!res.error)
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <span style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 13 }}>
        {building ? 'Analyzing your answers…' : 'Loading…'}
      </span>
      {building && <span style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 10 }}>Setting up your dashboard</span>}
    </div>
  )
  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 12 }}>{error}</span>
    </div>
  )

  // Module registry — add future add-ons here (this is the extension point).
  const modules: ModuleDef[] = [
    {
      key: 'report',
      label: 'DIAGNOSTIC REPORT',
      title: 'Your report',
      desc: 'Scores by area, the gaps with the most upside, quick wins, and bigger bets to validate.',
      accent: '#C8A96E',
      available: true,
      primary: { text: reportReady ? 'View report →' : 'Build report →', href: `/results?session=${sessionId}` },
      secondary: reportReady ? { text: '⤓ Download PDF', href: `/results?session=${sessionId}&print=1` } : undefined,
    },
    {
      key: 'pillars',
      label: 'AREA DEEP-DIVE',
      title: 'Your seven areas',
      desc: 'Each section of the interview — what we found, where the opportunity sits, and what data would sharpen it.',
      accent: '#7EB8A4',
      available: pillarsCovered > 0,
      badge: pillarsCovered > 0 ? `${pillarsCovered}/7 covered` : undefined,
      primary: { text: 'Open areas →', href: `/dashboard?session=${sessionId}` },
    },
    {
      key: 'transcript',
      label: 'CONVERSATION',
      title: 'Full transcript',
      desc: 'Everything you and the consultant covered, section by section.',
      accent: '#9A9080',
      available: true,
      primary: { text: 'Read transcript →', href: `/history?session=${sessionId}` },
    },
    {
      key: 'implement',
      label: 'COMING SOON',
      title: 'Work your plan',
      desc: 'Turn the analysis into action — tool walkthroughs, vetted experts to implement for you, and sources to dig deeper.',
      accent: '#5A5440',
      available: false,
      badge: 'In development',
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0C0C09', color: '#E8E0D0', fontFamily: 'Georgia, serif' }}>
      <ClientNav sessionId={sessionId} active="hub" businessName={businessName} />
      {/* Header */}
      <div style={{ background: '#0F0F0B', borderBottom: '1px solid #1A1A14', padding: '20px 32px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#4A4A38', fontFamily: 'monospace', marginBottom: 6 }}>YOUR DASHBOARD</div>
          <h1 style={{ fontSize: 26, fontWeight: 400, margin: 0 }}>{businessName}</h1>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px' }}>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#908870', margin: '0 0 28px', maxWidth: 600 }}>
          Everything from your diagnostic lives here. Start with the report for the big picture, then dig into any area.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {modules.map(m => (
            <div key={m.key} style={{
              background: '#111110',
              border: `1px solid ${m.available ? '#1E1E14' : '#161612'}`,
              borderRadius: 10, padding: '20px 22px',
              opacity: m.available ? 1 : 0.6,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.14em', color: m.accent, fontFamily: 'monospace' }}>{m.label}</span>
                {m.badge && (
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4A4A38', border: '1px solid #2A2A1E', borderRadius: 3, padding: '1px 6px' }}>{m.badge}</span>
                )}
              </div>
              <div style={{ fontSize: 18, color: '#D0C8B8' }}>{m.title}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: '#706850', fontFamily: 'monospace', margin: 0, flex: 1 }}>{m.desc}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                {m.available && m.primary && (
                  <button
                    onClick={() => router.push(m.primary!.href)}
                    style={{
                      background: 'transparent', border: `1px solid ${m.accent}40`, borderRadius: 6,
                      padding: '7px 14px', color: m.accent, fontFamily: 'monospace', fontSize: 12,
                      cursor: 'pointer', letterSpacing: '0.04em',
                    }}
                  >{m.primary.text}</button>
                )}
                {m.available && m.secondary && (
                  <button
                    onClick={() => router.push(m.secondary!.href)}
                    style={{
                      background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 6,
                      padding: '7px 14px', color: '#6A6450', fontFamily: 'monospace', fontSize: 12,
                      cursor: 'pointer', letterSpacing: '0.04em',
                    }}
                  >{m.secondary.text}</button>
                )}
                {!m.available && (
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#3A3A28', fontStyle: 'italic' }}>Not available yet</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function HubPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 12 }}>Loading…</div>
      </div>
    }>
      <HubContent />
    </Suspense>
  )
}
