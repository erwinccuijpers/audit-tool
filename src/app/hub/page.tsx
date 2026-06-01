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

  // Account / save-session state — lets anonymous owners claim this report.
  const [claimed, setClaimed] = useState(true) // true = logged in OR already linked; hides the CTA
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  // Lead-gen: email0 briefing preview + per-product interest toggles
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [email0, setEmail0] = useState<{ subject: string; body: string; area: string; source_ref?: string } | null>(null)
  const [email0Loading, setEmail0Loading] = useState(false)
  const [interests, setInterests] = useState<Record<string, string>>({})
  const [interestEmail, setInterestEmail] = useState('')
  const [savingInterest, setSavingInterest] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) { setError('No session ID.'); setLoading(false); return }
    load()
  }, [sessionId])

  async function load() {
    const { data: session } = await supabase
      .from('sessions')
      .select('business_name, status, report, dashboard_cache, user_id')
      .eq('id', sessionId!)
      .single()
    if (!session) { setError('Session not found.'); setLoading(false); return }
    setBusinessName(session.business_name || '')

    // Show the save CTA only when nobody is logged in AND this session isn't linked yet.
    const { data: { user } } = await supabase.auth.getUser()
    setClaimed(!!user || !!session.user_id)
    if (user?.email) { setUserEmail(user.email); setInterestEmail(user.email) }
    if (session.dashboard_cache?.v === 2) {
      setPillarsCovered(Object.keys(session.dashboard_cache?.pillars || {}).length)
    }

    // Generate the report once on first arrival, so the hub lands with it ready.
    let ready = false
    if (session.report) {
      ready = true; setReportReady(true)
    } else if (session.status === 'interview_done' || session.status === 'completed') {
      setBuilding(true)
      const res = await ensureReport(sessionId!)
      ready = !res.error; setReportReady(ready)
    }
    setLoading(false)

    // Once the diagnostic is done, load the email0 preview + any saved product interest.
    if (ready) loadBriefing()
  }

  async function loadBriefing() {
    // Current interest state (so toggles render correctly; email prefill if captured before)
    try {
      const r = await fetch(`/api/product-interest?session=${sessionId}`)
      const d = await r.json()
      if (d.interests) setInterests(d.interests)
      if (d.email && !userEmail) setInterestEmail(d.email)
    } catch { /* non-critical */ }

    // The email0 taster (cached server-side after first generation)
    setEmail0Loading(true)
    try {
      const r = await fetch('/api/briefing-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const d = await r.json()
      if (d.email0) setEmail0(d.email0)
    } catch { /* leave preview hidden */ }
    setEmail0Loading(false)
  }

  async function toggleInterest(productKey: string, status: 'interested' | 'not_interested') {
    const email = userEmail || interestEmail.trim() || null
    if (status === 'interested' && !email) return // UI requires an email first
    setSavingInterest(productKey)
    try {
      const r = await fetch('/api/product-interest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, productKey, status, email }),
      })
      if (r.ok) setInterests(prev => ({ ...prev, [productKey]: status }))
    } catch { /* ignore */ }
    setSavingInterest(null)
  }

  async function handleSave() {
    if (!authEmail.trim() || !authPassword.trim()) { setAuthError('Enter an email and password.'); return }
    setAuthLoading(true)
    setAuthError('')
    const { data, error } = authMode === 'signup'
      ? await supabase.auth.signUp({ email: authEmail, password: authPassword })
      : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) { setAuthError(error.message); setAuthLoading(false); return }
    if (data.user && sessionId) {
      await supabase.from('sessions').update({ user_id: data.user.id }).eq('id', sessionId)
    }
    setAuthLoading(false)
    setJustSaved(true)
    setClaimed(true)
    setAuthEmail(''); setAuthPassword('')
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
  ]

  // Lean Interested / Not-interested control (shared by both lead-gen cards).
  function InterestControl({ productKey, accent }: { productKey: string; accent: string }) {
    const status = interests[productKey]
    const saving = savingInterest === productKey
    const knownEmail = userEmail || interestEmail.trim()
    // No email captured yet (anonymous, first interaction) → ask for it once.
    if (!knownEmail && !status) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <input
            placeholder="your@email.com" type="email" value={interestEmail}
            onChange={e => setInterestEmail(e.target.value)}
            style={{ background: '#0C0C09', border: '1px solid #2A2A1E', borderRadius: 6, padding: '8px 12px', color: '#D0C8B8', fontFamily: 'monospace', fontSize: 13, minWidth: 200, flex: 1 }}
          />
          <button
            onClick={() => toggleInterest(productKey, 'interested')}
            disabled={saving || !interestEmail.trim()}
            style={{ background: 'transparent', border: `1px solid ${accent}`, borderRadius: 6, padding: '8px 14px', color: accent, fontFamily: 'monospace', fontSize: 12, cursor: saving || !interestEmail.trim() ? 'default' : 'pointer', opacity: saving || !interestEmail.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
          >{saving ? 'Saving…' : "I'm interested →"}</button>
        </div>
      )
    }
    // Email known → prefill + lean two-state toggle.
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#5A5440', marginBottom: 8 }}>
          {status === 'interested' ? '✓ ' : ''}We’ll send to <span style={{ color: '#908870' }}>{knownEmail}</span>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid #2A2A1E', borderRadius: 6, overflow: 'hidden' }}>
          {(['interested', 'not_interested'] as const).map(s => (
            <button
              key={s}
              onClick={() => toggleInterest(productKey, s)}
              disabled={saving}
              style={{
                background: status === s ? (s === 'interested' ? `${accent}22` : '#1A1410') : 'transparent',
                border: 'none', padding: '7px 14px',
                color: status === s ? (s === 'interested' ? accent : '#9A7A5A') : '#4A4A38',
                fontFamily: 'monospace', fontSize: 12, cursor: saving ? 'default' : 'pointer',
              }}
            >{s === 'interested' ? 'Interested' : 'Not interested'}</button>
          ))}
        </div>
      </div>
    )
  }

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

        {/* Save / create-account CTA — only for anonymous, unclaimed sessions */}
        {justSaved ? (
          <div style={{
            background: '#101410', border: '1px solid #1A2A1A', borderRadius: 10,
            padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: '#6AA36A', fontFamily: 'monospace', fontSize: 13 }}>✓ Saved.</span>
            <span style={{ color: '#807850', fontFamily: 'monospace', fontSize: 13 }}>This report is now linked to your account — you can come back to it anytime.</span>
          </div>
        ) : !claimed && (
          <div style={{
            background: '#12110C', border: '1px solid #2A2418', borderRadius: 10,
            padding: '20px 22px', marginBottom: 24,
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#C8A96E', fontFamily: 'monospace', marginBottom: 8 }}>SAVE YOUR REPORT</div>
            <div style={{ fontSize: 17, color: '#D0C8B8', marginBottom: 6 }}>
              {authMode === 'signup' ? 'Create a free account to keep this report' : 'Sign in to save this report'}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#706850', fontFamily: 'monospace', margin: '0 0 14px', maxWidth: 520 }}>
              Right now this report only lives in this browser. {authMode === 'signup' ? 'Create an account' : 'Sign in'} to come back to it from any device.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Email" type="email" value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                style={{ background: '#0C0C09', border: '1px solid #2A2A1E', borderRadius: 6, padding: '9px 12px', color: '#D0C8B8', fontFamily: 'monospace', fontSize: 13, minWidth: 180, flex: 1 }}
              />
              <input
                placeholder="Password" type="password" value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                style={{ background: '#0C0C09', border: '1px solid #2A2A1E', borderRadius: 6, padding: '9px 12px', color: '#D0C8B8', fontFamily: 'monospace', fontSize: 13, minWidth: 160, flex: 1 }}
              />
              <button
                onClick={handleSave} disabled={authLoading}
                style={{ background: 'transparent', border: '1px solid #C8A96E', borderRadius: 6, padding: '9px 16px', color: '#C8A96E', fontFamily: 'monospace', fontSize: 13, cursor: authLoading ? 'default' : 'pointer', letterSpacing: '0.04em', whiteSpace: 'nowrap', opacity: authLoading ? 0.6 : 1 }}
              >
                {authLoading ? 'Saving…' : authMode === 'signup' ? 'Save report →' : 'Sign in →'}
              </button>
            </div>
            {authError && <div style={{ color: '#E07B5A', fontFamily: 'monospace', fontSize: 12, marginTop: 10 }}>{authError}</div>}
            <button
              onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthError('') }}
              style={{ background: 'none', border: 'none', color: '#6A6450', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', marginTop: 12, padding: 0, textDecoration: 'underline' }}
            >
              {authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </div>
        )}

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

        {/* ── email0 — weekly briefing preview (lead magnet) ──────────────────── */}
        <div style={{ background: '#111110', border: '1px solid #1E1E14', borderRadius: 10, padding: '22px 24px', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.14em', color: '#C8A96E', fontFamily: 'monospace' }}>YOUR WEEKLY BRIEFING</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4A4A38', border: '1px solid #2A2A1E', borderRadius: 3, padding: '1px 6px' }}>PREVIEW · EMAIL #1</span>
            {email0?.area && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#7EB8A4', border: '1px solid #234', borderRadius: 3, padding: '1px 6px' }}>{email0.area}</span>}
          </div>
          <div style={{ fontSize: 18, color: '#D0C8B8', marginBottom: 4 }}>A taste of what lands in your inbox</div>

          {email0Loading && !email0 && (
            <p style={{ fontSize: 13, fontFamily: 'monospace', color: '#5A5440' }}>Writing your first briefing…</p>
          )}
          {email0 && (
            <div style={{ background: '#0C0C09', border: '1px solid #1A1A14', borderRadius: 8, padding: '18px 20px', margin: '10px 0 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#5A5440', marginBottom: 8 }}>Subject</div>
              <div style={{ fontSize: 16, color: '#E8E0D0', marginBottom: 14 }}>{email0.subject}</div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: '#C0B8A8', whiteSpace: 'pre-wrap' }}>{email0.body}</div>
              {email0.source_ref && <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#3A3A28', marginTop: 14 }}>ref {email0.source_ref}</div>}
            </div>
          )}
          {!email0 && !email0Loading && (
            <p style={{ fontSize: 13, fontFamily: 'monospace', color: '#5A5440', margin: '8px 0 14px' }}>
              Your personalized briefing will appear here shortly after your diagnostic is processed.
            </p>
          )}

          {/* Pitch copy is a placeholder — to be refined later. */}
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#807850', fontFamily: 'monospace', margin: '0 0 4px', maxWidth: 560 }}>
            Want a fresh one of these every week — matched to your business? Free during the test, no card.
          </p>
          <InterestControl productKey="newsletter" accent="#C8A96E" />
        </div>

        {/* ── Work your plan (interest capture) ───────────────────────────────── */}
        <div style={{ background: '#111110', border: '1px solid #161612', borderRadius: 10, padding: '22px 24px', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.14em', color: '#9A8A6A', fontFamily: 'monospace' }}>WORK YOUR PLAN</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4A4A38', border: '1px solid #2A2A1E', borderRadius: 3, padding: '1px 6px' }}>In development</span>
          </div>
          <div style={{ fontSize: 18, color: '#D0C8B8', marginBottom: 4 }}>Turn the analysis into action</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#807850', fontFamily: 'monospace', margin: '0 0 4px', maxWidth: 560 }}>
            Tool walkthroughs, vetted experts to implement for you, and sources to dig deeper. Want this when it’s ready?
          </p>
          <InterestControl productKey="work_your_plan" accent="#9A8A6A" />
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
