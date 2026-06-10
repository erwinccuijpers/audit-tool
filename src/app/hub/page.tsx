'use client'
import { useEffect, useState, Suspense, type ReactNode } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { loadReport } from '@/lib/report'
import ClientNav from '@/components/ClientNav'

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Focused full-screen overlay — clearer than an inline reveal, especially on mobile.
function FullScreenPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,8,6,0.97)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ position: 'sticky', top: 0, background: '#FBFAF7', borderBottom: '1px solid #E5E1D8', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 1 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.14em', color: '#8A6D2F', fontFamily: 'monospace', flex: 1 }}>{title}</span>
        <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: '1px solid #D8D2C6', borderRadius: 6, padding: '7px 13px', color: '#6B675E', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer' }}>✕ Close</button>
      </div>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 18px 64px' }}>
        {children}
      </div>
    </div>
  )
}

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
  // Seconds spent on the loader — drives a reassurance line once the build runs
  // long (synthesis over the full transcript can take ~a minute).
  const [loaderSeconds, setLoaderSeconds] = useState(0)
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => setLoaderSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [loading])

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
  const [showEmail0, setShowEmail0] = useState(false)
  const [showSuggestion, setShowSuggestion] = useState(false)
  const [suggestionText, setSuggestionText] = useState('')
  const [suggestionSent, setSuggestionSent] = useState(false)
  const [editingEmail, setEditingEmail] = useState<string | null>(null) // productKey being edited
  const [emailDraft, setEmailDraft] = useState('')

  useEffect(() => {
    if (!sessionId) { setError('No session ID.'); setLoading(false); return }
    let cleanup: (() => void) | undefined
    load(fn => { cleanup = fn })
    return () => { cleanup?.() }
  }, [sessionId])

  // Deep-link from the hamburger menu: ?panel=briefing|suggestion|workplan acts
  // once the hub has loaded, then the param is cleared. Clearing matters — without
  // it, re-clicking the same menu item pushes an unchanged URL, so the effect
  // wouldn't re-fire and the panel wouldn't re-open after being closed.
  useEffect(() => {
    if (loading) return
    const panel = searchParams.get('panel')
    if (!panel) return
    if (panel === 'briefing') setShowEmail0(true)
    else if (panel === 'suggestion') setShowSuggestion(true)
    else if (panel === 'workplan') {
      setTimeout(() => document.getElementById('workplan-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    }
    router.replace(`/hub?session=${sessionId}`, { scroll: false })
  }, [loading, searchParams, sessionId, router])

  async function load(registerCleanup?: (fn: () => void) => void) {
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

    // Report already generated → land straight on it.
    if (session.report) {
      setReportReady(true); setLoading(false); loadBriefing()
      return
    }

    // Not generated yet: trigger + poll. The loader stays up (building) until the
    // report lands — which survives a dropped connection because /api/synthesize
    // persists it server-side and loadReport polls the DB for it.
    if (session.status === 'interview_done' || session.status === 'completed') {
      setBuilding(true)
      const cleanup = loadReport(
        sessionId!,
        () => { setReportReady(true); setLoading(false); loadBriefing() },
        (msg) => { setError(msg); setLoading(false) },
      )
      registerCleanup?.(cleanup)
    } else {
      setLoading(false)
    }
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
    const email = interestEmail.trim() || userEmail || null
    // Interested requires a valid email; "Not interested" can be recorded without one.
    if (status === 'interested' && (!email || !EMAIL_RE.test(email))) return
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

  async function saveEmail() {
    const e = emailDraft.trim()
    if (!EMAIL_RE.test(e)) return
    try {
      const r = await fetch('/api/update-lead-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email: e }),
      })
      if (r.ok) { setInterestEmail(e); setEditingEmail(null) }
    } catch { /* ignore */ }
  }

  async function submitSuggestion() {
    const email = interestEmail.trim() || userEmail || null
    if (!suggestionText.trim() || !email || !EMAIL_RE.test(email)) return
    setSavingInterest('open_suggestions')
    try {
      const r = await fetch('/api/product-interest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, productKey: 'open_suggestions', status: 'interested', email, note: suggestionText.trim() }),
      })
      if (r.ok) { setSuggestionSent(true); setShowSuggestion(false); setInterests(prev => ({ ...prev, open_suggestions: 'interested' })) }
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
      <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
        <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', marginBottom: 28 }}>
          {building ? 'DIAGNOSTIC REPORT' : 'POCKET CMO'}
        </div>
        <div style={{ width: 180, height: 2, background: '#E5E1D8', borderRadius: 1, position: 'relative', overflow: 'hidden', marginBottom: 28 }}>
          <div style={{
            position: 'absolute', top: 0, height: '100%',
            background: 'linear-gradient(90deg, transparent, #C8A96E, transparent)',
            borderRadius: 1, animation: 'cmo-slide 1.8s ease-in-out infinite',
          }} />
        </div>
        <div style={{ color: '#8A6D2F', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.04em', marginBottom: 16 }}>
          {building ? 'Analyzing your answers' : 'Loading'}
        </div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 28 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#8A857A',
              animation: `cmo-dot 1.4s ease-in-out ${i * 0.22}s infinite`,
            }} />
          ))}
        </div>
        {building && (
          <div style={{ textAlign: 'center', lineHeight: 1.7 }}>
            <div style={{ color: '#D8D2C6', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em' }}>
              Building your dashboard — this can take up to a minute…
            </div>
            <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', marginTop: 8 }}>
              Keep this screen open — your dashboard appears here automatically when it&apos;s ready.
            </div>
            {loaderSeconds >= 30 && (
              <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', marginTop: 8 }}>
                Still gathering — no worries, this one&apos;s taking a bit longer.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
  if (error) return (
    <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#BF4A2E', fontFamily: 'monospace', fontSize: 12 }}>{error}</span>
    </div>
  )

  // Module registry — add future add-ons here (this is the extension point).
  const modules: ModuleDef[] = [
    {
      key: 'report',
      label: 'DIAGNOSTIC REPORT',
      title: 'Your report',
      desc: 'Scores by area, the gaps with the most upside, quick wins, and bigger bets to validate.',
      accent: '#8A6D2F',
      available: true,
      primary: { text: reportReady ? 'View report →' : 'Build report →', href: `/results?session=${sessionId}` },
      secondary: reportReady ? { text: '⤓ Download PDF', href: `/results?session=${sessionId}&print=1` } : undefined,
    },
    {
      key: 'pillars',
      label: 'AREA DEEP-DIVE',
      title: 'Your seven areas',
      desc: 'Each section of the interview — what we found, where the opportunity sits, and what data would sharpen it.',
      accent: '#3F7E68',
      available: pillarsCovered > 0,
      badge: pillarsCovered > 0 ? `${pillarsCovered}/7 covered` : undefined,
      primary: { text: 'Open areas →', href: `/dashboard?session=${sessionId}` },
    },
    {
      key: 'transcript',
      label: 'CONVERSATION',
      title: 'Full transcript',
      desc: 'Everything you and the consultant covered, section by section.',
      accent: '#6B675E',
      available: true,
      primary: { text: 'Read transcript →', href: `/history?session=${sessionId}` },
    },
  ]

  // Lean Interested / Not-interested control (shared by both lead-gen cards).
  // Rendered as a plain function call (not <InterestControl/>) — defining a component
  // inside HubContent gives it a new identity every render, which remounts the <input>
  // and drops focus after each keystroke. Inlining the elements keeps focus stable.
  const renderInterest = (productKey: string, accent: string) => {
    const status = interests[productKey]
    const saving = savingInterest === productKey
    const knownEmail = interestEmail.trim() || userEmail || ''
    const inputValid = EMAIL_RE.test(interestEmail.trim())

    // No email captured yet (anonymous, first interaction) → ask for it once, validated.
    if (!knownEmail && !status) {
      return (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="your@email.com" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={interestEmail}
              onChange={e => setInterestEmail(e.target.value)}
              style={{ background: '#FBFAF7', border: `1px solid ${interestEmail && !inputValid ? '#8A5A20' : '#D8D2C6'}`, borderRadius: 6, padding: '8px 12px', color: '#1A1815', fontFamily: 'monospace', fontSize: 13, minWidth: 200, flex: 1 }}
            />
            <button
              onClick={() => toggleInterest(productKey, 'interested')}
              disabled={saving || !inputValid}
              style={{ background: 'transparent', border: `1px solid ${accent}`, borderRadius: 6, padding: '8px 14px', color: accent, fontFamily: 'monospace', fontSize: 12, cursor: saving || !inputValid ? 'default' : 'pointer', opacity: saving || !inputValid ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >{saving ? 'Saving…' : "I'm interested →"}</button>
          </div>
          {interestEmail && !inputValid && <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B675E', marginTop: 6 }}>Enter a valid email address.</div>}
        </div>
      )
    }

    // Email known → prefill + lean two-state toggle, with an inline "change" editor.
    const draftValid = EMAIL_RE.test(emailDraft.trim())
    return (
      <div style={{ marginTop: 4 }}>
        {editingEmail === productKey ? (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)} placeholder="your@email.com"
                style={{ background: '#FBFAF7', border: `1px solid ${emailDraft && !draftValid ? '#8A5A20' : '#D8D2C6'}`, borderRadius: 6, padding: '7px 11px', color: '#1A1815', fontFamily: 'monospace', fontSize: 12, minWidth: 200, flex: 1 }}
              />
              <button onClick={saveEmail} disabled={!draftValid}
                style={{ background: 'transparent', border: `1px solid ${accent}`, borderRadius: 6, padding: '7px 12px', color: accent, fontFamily: 'monospace', fontSize: 12, cursor: draftValid ? 'pointer' : 'default', opacity: draftValid ? 1 : 0.5 }}>Save</button>
              <button onClick={() => setEditingEmail(null)}
                style={{ background: 'transparent', border: '1px solid #D8D2C6', borderRadius: 6, padding: '7px 10px', color: '#6B675E', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
            {emailDraft && !draftValid && <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B675E', marginTop: 6 }}>Enter a valid email address.</div>}
          </div>
        ) : (
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#D8D2C6', marginBottom: 8 }}>
            {status === 'interested' ? '✓ ' : ''}We’ll send to <span style={{ color: '#5A564E' }}>{knownEmail}</span>
            <button onClick={() => { setEmailDraft(knownEmail); setEditingEmail(productKey) }}
              style={{ background: 'none', border: 'none', color: accent, fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', marginLeft: 8, padding: 0, textDecoration: 'underline' }}>change</button>
          </div>
        )}
        <div style={{ display: 'inline-flex', border: '1px solid #D8D2C6', borderRadius: 6, overflow: 'hidden' }}>
          {(['interested', 'not_interested'] as const).map(s => (
            <button
              key={s}
              onClick={() => toggleInterest(productKey, s)}
              disabled={saving}
              style={{
                background: status === s ? (s === 'interested' ? `${accent}22` : '#F4F1EA') : 'transparent',
                border: 'none', padding: '7px 14px',
                color: status === s ? (s === 'interested' ? accent : '#6B675E') : '#8A857A',
                fontFamily: 'monospace', fontSize: 12, cursor: saving ? 'default' : 'pointer',
              }}
            >{s === 'interested' ? 'Interested' : 'Not interested'}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FBFAF7', color: '#2A2A28', fontFamily: 'Georgia, serif' }}>
      <ClientNav sessionId={sessionId} active="hub" businessName={businessName} />
      {/* Header */}
      <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E1D8', padding: '20px 32px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#8A857A', fontFamily: 'monospace', marginBottom: 6 }}>YOUR DASHBOARD</div>
          <h1 style={{ fontSize: 26, fontWeight: 400, margin: 0 }}>{businessName}</h1>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px' }}>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#5A564E', margin: '0 0 28px', maxWidth: 600 }}>
          Everything from your diagnostic lives here. Start with the report for the big picture, then dig into any area.
        </p>

        {/* Save / create-account CTA — only for anonymous, unclaimed sessions */}
        {justSaved ? (
          <div style={{
            background: '#EFF5F1', border: '1px solid #D8E5DC', borderRadius: 10,
            padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: '#3F7E68', fontFamily: 'monospace', fontSize: 13 }}>✓ Saved.</span>
            <span style={{ color: '#5A564E', fontFamily: 'monospace', fontSize: 13 }}>This report is now linked to your account — you can come back to it anytime.</span>
          </div>
        ) : !claimed && (
          <div style={{
            background: '#F4F1EA', border: '1px solid #D8D2C6', borderRadius: 10,
            padding: '20px 22px', marginBottom: 24,
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#8A6D2F', fontFamily: 'monospace', marginBottom: 8 }}>SAVE YOUR REPORT</div>
            <div style={{ fontSize: 17, color: '#1A1815', marginBottom: 6 }}>
              {authMode === 'signup' ? 'Create a free account to keep this report' : 'Sign in to save this report'}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: '0 0 14px', maxWidth: 520 }}>
              Right now this report only lives in this browser. {authMode === 'signup' ? 'Create an account' : 'Sign in'} to come back to it from any device.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Email" type="email" value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                style={{ background: '#FBFAF7', border: '1px solid #D8D2C6', borderRadius: 6, padding: '9px 12px', color: '#1A1815', fontFamily: 'monospace', fontSize: 13, minWidth: 180, flex: 1 }}
              />
              <input
                placeholder="Password" type="password" value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                style={{ background: '#FBFAF7', border: '1px solid #D8D2C6', borderRadius: 6, padding: '9px 12px', color: '#1A1815', fontFamily: 'monospace', fontSize: 13, minWidth: 160, flex: 1 }}
              />
              <button
                onClick={handleSave} disabled={authLoading}
                style={{ background: 'transparent', border: '1px solid #C8A96E', borderRadius: 6, padding: '9px 16px', color: '#8A6D2F', fontFamily: 'monospace', fontSize: 13, cursor: authLoading ? 'default' : 'pointer', letterSpacing: '0.04em', whiteSpace: 'nowrap', opacity: authLoading ? 0.6 : 1 }}
              >
                {authLoading ? 'Saving…' : authMode === 'signup' ? 'Save report →' : 'Sign in →'}
              </button>
            </div>
            {authError && <div style={{ color: '#BF4A2E', fontFamily: 'monospace', fontSize: 12, marginTop: 10 }}>{authError}</div>}
            <button
              onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthError('') }}
              style={{ background: 'none', border: 'none', color: '#6B675E', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', marginTop: 12, padding: 0, textDecoration: 'underline' }}
            >
              {authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
          {modules.map(m => (
            <div key={m.key} style={{
              background: '#FFFFFF',
              border: `1px solid ${m.available ? '#E5E1D8' : '#F4F1EA'}`,
              borderRadius: 10, padding: '20px 22px',
              opacity: m.available ? 1 : 0.6,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.14em', color: m.accent, fontFamily: 'monospace' }}>{m.label}</span>
                {m.badge && (
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#8A857A', border: '1px solid #D8D2C6', borderRadius: 3, padding: '1px 6px' }}>{m.badge}</span>
                )}
              </div>
              <div style={{ fontSize: 18, color: '#1A1815' }}>{m.title}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: 0, flex: 1 }}>{m.desc}</p>
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
                      background: 'transparent', border: '1px solid #D8D2C6', borderRadius: 6,
                      padding: '7px 14px', color: '#6B675E', fontFamily: 'monospace', fontSize: 12,
                      cursor: 'pointer', letterSpacing: '0.04em',
                    }}
                  >{m.secondary.text}</button>
                )}
                {!m.available && (
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#8A857A', fontStyle: 'italic' }}>Not available yet</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── What's next — products in development (each captures interest) ───── */}
        <div style={{ marginTop: 30, marginBottom: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#8A857A', fontFamily: 'monospace', marginBottom: 6 }}>COMING SOON — HELP US SHAPE IT</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: 0, maxWidth: 600 }}>
            What we’re building next. Tell us what you’d actually use — it directs what we ship.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 14, alignItems: 'start' }}>
          {/* Personalized briefing (newsletter) */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E5E1D8', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, letterSpacing: '0.14em', color: '#8A6D2F', fontFamily: 'monospace' }}>PERSONALIZED NEWSLETTER</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#8A857A', border: '1px solid #D8D2C6', borderRadius: 3, padding: '1px 6px' }}>In development</span>
            </div>
            <div style={{ fontSize: 17, color: '#1A1815' }}>Custom actionable-insights newsletter</div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: 0, flex: 1 }}>
              Every email a new, usable lesson — drawn from real cases that fit your business. Not a generic newsletter.
            </p>
            <button
              onClick={() => setShowEmail0(true)}
              style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #C8A96E66', borderRadius: 6, padding: '7px 14px', color: '#8A6D2F', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', letterSpacing: '0.04em' }}
            >Let me read it first →</button>
            {renderInterest('newsletter', '#8A6D2F')}
          </div>

          {/* Work your plan */}
          <div id="workplan-card" style={{ background: '#FFFFFF', border: '1px solid #F4F1EA', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 9, scrollMarginTop: 80 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, letterSpacing: '0.14em', color: '#6B675E', fontFamily: 'monospace' }}>WORK YOUR PLAN</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#8A857A', border: '1px solid #D8D2C6', borderRadius: 3, padding: '1px 6px' }}>In development</span>
            </div>
            <div style={{ fontSize: 17, color: '#1A1815' }}>Put the plan to work</div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: 0, flex: 1 }}>
              Start working with your data: actionable implementation plans, and update your profile on the go as your business grows.
            </p>
            {renderInterest('work_your_plan', '#6B675E')}
          </div>

          {/* Open suggestions */}
          <div style={{ background: '#FFFFFF', border: '1px solid #F4F1EA', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.14em', color: '#3F7E68', fontFamily: 'monospace' }}>OPEN SUGGESTIONS</span>
            <div style={{ fontSize: 17, color: '#1A1815' }}>Tell us what you need</div>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', margin: 0 }}>
              Have an idea, want to work with us, or need a custom feature? Send it — we’ll notify you when we roll it out.
            </p>
            {suggestionSent ? (
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#3F7E68', marginTop: 2 }}>✓ Thanks — we’ll be in touch.</div>
            ) : (
              <button
                onClick={() => setShowSuggestion(true)}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #3F7E68', borderRadius: 6, padding: '7px 14px', color: '#3F7E68', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', letterSpacing: '0.04em' }}
              >Write a suggestion →</button>
            )}
          </div>
        </div>
      </div>

      {/* Full-screen email0 example */}
      {showEmail0 && (
        <FullScreenPanel title="PERSONALIZED NEWSLETTER — EXAMPLE" onClose={() => setShowEmail0(false)}>
          {email0Loading && !email0 && <p style={{ fontSize: 14, fontFamily: 'monospace', color: '#D8D2C6' }}>Writing your example…</p>}
          {email0 && (
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E1D8', borderRadius: 10, padding: '22px 24px', marginBottom: 18 }}>
              {email0.area && <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#3F7E68', marginBottom: 12, letterSpacing: '0.12em' }}>FOCUS · {email0.area.toUpperCase()}</div>}
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#D8D2C6', marginBottom: 8 }}>Subject</div>
              <div style={{ fontSize: 18, color: '#2A2A28', marginBottom: 18 }}>{email0.subject}</div>
              <div style={{ fontSize: 15, lineHeight: 1.75, color: '#3A3833', whiteSpace: 'pre-wrap' }}>{email0.body}</div>
            </div>
          )}
          {!email0 && !email0Loading && <p style={{ fontSize: 14, fontFamily: 'monospace', color: '#D8D2C6' }}>Your example will appear once your diagnostic is processed.</p>}
          <div style={{ fontSize: 12.5, lineHeight: 1.8, color: '#6B675E', fontFamily: 'monospace', borderTop: '1px solid #E5E1D8', paddingTop: 16 }}>
            We’re sitting on a large library of real business stories and cases. We match your profile against it and send you the ones carrying lessons you can act on right away — think of it as a consultant looking at your situation and hand-picking the most useful stories for you. It’s about the most personalized email you’ll ever get. Show interest and we’ll keep you in the loop as we roll it out.
          </div>
          <div style={{ marginTop: 18 }}>
            {renderInterest('newsletter', '#8A6D2F')}
          </div>
        </FullScreenPanel>
      )}

      {/* Full-screen suggestion form — roomy on mobile */}
      {showSuggestion && (
        <FullScreenPanel title="SEND US A SUGGESTION" onClose={() => setShowSuggestion(false)}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5A564E', fontFamily: 'monospace', marginTop: 0, marginBottom: 16 }}>
            Have an idea, want to work with us, or need a custom feature? Write as much as you like — we read every one and notify you when we roll it out.
          </p>
          <textarea
            value={suggestionText}
            onChange={e => setSuggestionText(e.target.value)}
            placeholder="e.g. I'd like to work with you · I want to white-label this for my own consulting business · I need this specific feature…"
            autoFocus
            style={{ background: '#FBFAF7', border: '1px solid #D8D2C6', borderRadius: 8, padding: '14px 16px', color: '#2A2A28', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6, resize: 'vertical', width: '100%', boxSizing: 'border-box', minHeight: '40vh' }}
          />
          {!userEmail && (
            <input
              placeholder="your@email.com" type="email" value={interestEmail}
              onChange={e => setInterestEmail(e.target.value)}
              style={{ marginTop: 12, background: '#FBFAF7', border: '1px solid #D8D2C6', borderRadius: 8, padding: '11px 14px', color: '#2A2A28', fontFamily: 'monospace', fontSize: 14, width: '100%', boxSizing: 'border-box' }}
            />
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {(() => {
              const ready = !!suggestionText.trim() && EMAIL_RE.test(interestEmail.trim() || userEmail || '') && savingInterest !== 'open_suggestions'
              return (
                <button
                  onClick={submitSuggestion}
                  disabled={!ready}
                  style={{ background: 'transparent', border: '1px solid #3F7E68', borderRadius: 6, padding: '10px 20px', color: '#3F7E68', fontFamily: 'monospace', fontSize: 13, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5 }}
                >{savingInterest === 'open_suggestions' ? 'Sending…' : 'Send suggestion →'}</button>
              )
            })()}
            <button onClick={() => setShowSuggestion(false)} style={{ background: 'transparent', border: '1px solid #D8D2C6', borderRadius: 6, padding: '10px 18px', color: '#6B675E', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </FullScreenPanel>
      )}
    </div>
  )
}

export default function HubPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 12 }}>Loading…</div>
      </div>
    }>
      <HubContent />
    </Suspense>
  )
}
