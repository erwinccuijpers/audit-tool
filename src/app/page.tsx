'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import SideNav from '@/components/SideNav'

type Question = {
  id: string
  category: string
  core_question: string
  weakness: string
  tool_note: string | null
  sort_order: number
  applies_to: string[]
  follow_ups: { text: string }[]
}

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type BusinessProfile = {
  business_description: string
  business_type: string
  industry: string
  awareness_level: string
  owner_tone: string
  first_name: string | null
  skip_questions: string[]
  emphasis_areas: string[]
}

type Phase = 'start' | 'intro' | 'classifying' | 'interview' | 'done'

const INTRO_OPENER = `Tell me about your business like you're explaining it to someone you just met — what do you do, who do you do it for, and what's the thing you're most proud of?`

const INTRO_FOLLOWUPS = [
  `And if you're being honest with yourself — do you have a gut feeling about where you're leaving money on the table, or are you here because you genuinely don't know?`,
]

const TRANSITIONS = [
  "Got it.",
  "Makes sense.",
  "Noted.",
  "Good to know.",
  "That helps.",
  "Understood.",
  "Appreciate that.",
  "Clear.",
]

function getTransition(index: number) {
  return TRANSITIONS[index % TRANSITIONS.length]
}

export default function InterviewPage() {
  const [phase, setPhase] = useState<Phase>('start')
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [conversation, setConversation] = useState<Message[]>([])
  const [introConversation, setIntroConversation] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [completedSummaries, setCompletedSummaries] = useState<{ question: string; summary: string }[]>([])
  const [introTurns, setIntroTurns] = useState(0)
  const [transitionCount, setTransitionCount] = useState(0)
  const [aiError, setAiError] = useState(false)
  const lastPayload = useRef<object | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // auth state
  const [user, setUser] = useState<any>(null)
  const [resumableSession, setResumableSession] = useState<any>(null)
  const [showSignIn, setShowSignIn] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false)
  const [showSetNewPassword, setShowSetNewPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [interviewTransition, setInterviewTransition] = useState('')
  const [showSaveOverlay, setShowSaveOverlay] = useState(false)
  const [saveOverlayDismissed, setSaveOverlayDismissed] = useState(false)
  const [overlayMode, setOverlayMode] = useState<'signup' | 'signin'>('signup')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('questions')
        .select('*, follow_ups(text, sort_order)')
        .order('sort_order')
      if (data) setAllQuestions(data)
    }
    load()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, introConversation])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') setShowSetNewPassword(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || allQuestions.length === 0 || phase !== 'start') return
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => { if (data) setResumableSession(data) })
  }, [user, allQuestions, phase])

  // Auto-resume when returning from the dashboard
  useEffect(() => {
    if (phase !== 'start' || !resumableSession) return
    const flag = sessionStorage.getItem('autoResume')
    if (flag) {
      sessionStorage.removeItem('autoResume')
      resumeSession(resumableSession)
    }
  }, [resumableSession, phase])

  async function startSession() {
    if (!businessName.trim() || allQuestions.length === 0) return
    const { data } = await supabase
      .from('sessions')
      .insert({ business_name: businessName, status: 'intro', user_id: user?.id ?? null })
      .select()
      .single()
    if (data) {
      setSessionId(data.id)
      sessionStorage.setItem('audit_session_id', data.id)
      setPhase('intro')
      const opener: Message = { role: 'assistant', content: INTRO_OPENER }
      setIntroConversation([opener])
      setConversation([opener])
    }
  }

  async function classifyAndTransition(finalIntroConv: Message[]) {
    setPhase('classifying')

    let detectedProfile
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 40000)
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation: finalIntroConv, businessName }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error('classify error')
      const json = await res.json()
      detectedProfile = json.profile
    } catch {
      setAiError(true)
      setPhase('interview')
      return
    }
    setProfile(detectedProfile)

    await supabase.from('sessions').update({
      business_description: detectedProfile.business_description,
      business_type: detectedProfile.business_type,
      industry: detectedProfile.industry,
      awareness_level: detectedProfile.awareness_level,
      owner_tone: detectedProfile.owner_tone,
      status: 'in_progress',
    }).eq('id', sessionId)

    const filtered = allQuestions.filter(q => {
      if (detectedProfile.skip_questions?.includes(q.id)) return false
      if (!q.applies_to || q.applies_to.length === 0) return true
      return q.applies_to.includes(detectedProfile.business_type) || q.applies_to.includes('all')
    })

    setQuestions(filtered)

    const awarenessLine = detectedProfile.awareness_level === 'knows_the_gap'
      ? `You already have a sense of where the gaps are — let's see if the numbers back that up.`
      : detectedProfile.awareness_level === 'has_a_hunch'
      ? `You have a hunch something's off — let's dig into where exactly.`
      : `Let's map out the full picture and find where the opportunities are hiding.`

    const transition = `Got it — that's really helpful context. ${awarenessLine}\n\nDepending on how complex your business is, this usually takes between 1 and 1.5 hours. Some questions will feel obvious, some might surprise you. Just answer honestly — that's what makes this useful.\n\n${filtered[0].core_question}`

    setInterviewTransition(transition)
    setConversation(prev => [...prev, { role: 'assistant', content: transition }])
    setPhase('interview')
  }

  async function handleSignUp() {
    setAuthLoading(true)
    setAuthError('')
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
    if (error) {
      setAuthError(error.message)
      setAuthLoading(false)
      return
    }
    if (data.user && sessionId) {
      await supabase.from('sessions').update({ user_id: data.user.id }).eq('id', sessionId)
      setUser(data.user)
    }
    setAuthLoading(false)
    setShowSaveOverlay(false)
    setAuthEmail('')
    setAuthPassword('')
    setAuthError('')
  }

  async function handleSignIn(fromOverlay = false) {
    setAuthLoading(true)
    setAuthError('')
    const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) {
      setAuthError(error.message)
      setAuthLoading(false)
      return
    }
    if (!data.user) { setAuthLoading(false); return }
    setUser(data.user)

    if (fromOverlay) {
      if (sessionId) {
        await supabase.from('sessions').update({ user_id: data.user.id }).eq('id', sessionId)
      }
      setShowSaveOverlay(false)
      setAuthEmail('')
      setAuthPassword('')
      setAuthError('')
      setAuthLoading(false)
      return
    }

    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', data.user.id)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (session) {
      await resumeSession(session)
    } else {
      setShowSignIn(false)
    }
    setAuthLoading(false)
  }

  async function handleForgotPassword() {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
      redirectTo: 'https://pocketcmo.pro',
    })
    if (error) { setAuthError(error.message) } else { setForgotPasswordSent(true) }
    setAuthLoading(false)
  }

  async function handleSetNewPassword() {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setAuthError(error.message); setAuthLoading(false); return }
    setShowSetNewPassword(false)
    setNewPassword('')
    setAuthLoading(false)
  }

  async function resumeSession(session: any) {
    setSessionId(session.id)
    setBusinessName(session.business_name)
    const restoredProfile: BusinessProfile = {
      business_description: session.business_description || '',
      business_type: session.business_type || '',
      industry: session.industry || '',
      awareness_level: session.awareness_level || '',
      owner_tone: session.owner_tone || '',
      first_name: null,
      skip_questions: [],
      emphasis_areas: [],
    }
    setProfile(restoredProfile)
    const filtered = allQuestions.filter(q => {
      if (!q.applies_to || q.applies_to.length === 0) return true
      return q.applies_to.includes(session.business_type) || q.applies_to.includes('all')
    })
    setQuestions(filtered)

    const summaries = session.completed_summaries || []
    setCompletedSummaries(summaries)

    // Use the higher of stored index or number of completed summaries (handles legacy sessions)
    const qIdx = Math.min(
      Math.max(session.current_q_index || 0, summaries.length),
      Math.max(0, filtered.length - 1)
    )
    setQIndex(qIdx)

    const currentQ = filtered[qIdx]
    let resumeConv: Message[] = []

    // Try to load full conversation from current question's saved response
    if (currentQ) {
      const { data: currentResp } = await supabase
        .from('responses')
        .select('conversation')
        .eq('session_id', session.id)
        .eq('question_id', currentQ.id)
        .single()

      if (currentResp && currentResp.conversation && currentResp.conversation.length > 0) {
        resumeConv = [
          ...currentResp.conversation,
          { role: 'assistant' as const, content: `Welcome back. Let's continue.` },
        ]
      }
    }

    // If current question has no history yet, load from the previous completed question
    // (each saved conversation contains the full chat history up to that point)
    if (resumeConv.length === 0 && qIdx > 0) {
      const prevQ = filtered[qIdx - 1]
      if (prevQ) {
        const { data: prevResp } = await supabase
          .from('responses')
          .select('conversation')
          .eq('session_id', session.id)
          .eq('question_id', prevQ.id)
          .single()

        if (prevResp && prevResp.conversation && prevResp.conversation.length > 0) {
          resumeConv = [
            ...prevResp.conversation,
            {
              role: 'assistant' as const,
              content: `Welcome back. Let's pick up where we left off.\n\n${currentQ?.core_question || ''}`,
            },
          ]
        }
      }
    }

    // Final fallback
    if (resumeConv.length === 0 && currentQ) {
      resumeConv = [{
        role: 'assistant' as const,
        content: `Welcome back to ${session.business_name}. Let's continue.\n\n${currentQ.core_question}`,
      }]
    }

    setConversation(resumeConv)
    setPhase('interview')
    setShowSignIn(false)
    setResumableSession(null)
  }

  async function sendIntro(userInput: string) {
    const userMsg: Message = { role: 'user', content: userInput }
    const newConv = [...conversation, userMsg]
    setConversation(newConv)
    setInput('')
    setLoading(true)

    const newTurns = introTurns + 1
    setIntroTurns(newTurns)

    if (newTurns >= 2) {
      await classifyAndTransition(newConv)
      setLoading(false)
      return
    }

    const followup = INTRO_FOLLOWUPS[newTurns - 1]
    if (followup) {
      setConversation(prev => [...prev, { role: 'assistant', content: followup }])
    }
    setLoading(false)
  }

  async function saveResponse(qId: string, conv: Message[]) {
    if (!sessionId) return
    const { error } = await supabase.from('responses').upsert({
      session_id: sessionId,
      question_id: qId,
      conversation: conv,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,question_id' })
    if (error) console.error('Save error:', error.message)
  }

  async function checkIfAlreadyCovered(
    q: Question,
    summaries: { question: string; summary: string }[]
  ): Promise<boolean> {
    if (summaries.length === 0) return false
    const res = await fetch('/api/precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q.core_question,
        context: summaries,
        businessProfile: profile,
      }),
    })
    const { covered } = await res.json()
    return covered === true
  }

  async function sendInterview(userInput: string) {
    const currentQ = questions[qIndex]
    const userMsg: Message = { role: 'user', content: userInput }
    const newConv = [...conversation, userMsg]
    setConversation(newConv)
    setInput('')
    setLoading(true)

    const payload = {
      question: currentQ.core_question,
      followUps: currentQ.follow_ups.map((f: { text: string }) => f.text),
      toolNote: currentQ.tool_note,
      conversation: newConv,
      previousContext: completedSummaries,
      businessProfile: profile,
    }
    lastPayload.current = payload

    let message: string
    let isComplete: boolean

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 40000)
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      message = data.message
      isComplete = data.isComplete
    } catch {
      setAiError(true)
      setLoading(false)
      return
    }

    if (isComplete) {
      await saveResponse(currentQ.id, newConv)
      const ownerReplies = newConv.filter(m => m.role === 'user').map(m => m.content).join(' / ')
      const newSummary = { question: currentQ.core_question, summary: ownerReplies }
      const updatedSummaries = [...completedSummaries, newSummary]
      setCompletedSummaries(updatedSummaries)

      let nextIndex = qIndex + 1
      while (nextIndex < questions.length) {
        const candidate = questions[nextIndex]
        const alreadyCovered = await checkIfAlreadyCovered(candidate, updatedSummaries)
        if (!alreadyCovered) break
        await saveResponse(candidate.id, [])
        nextIndex++
      }

      const tc = transitionCount
      setTransitionCount(tc + 1)

      // Show save overlay after question 6 for non-logged-in users (once only)
      if (nextIndex >= 6 && !user && !saveOverlayDismissed) {
        setShowSaveOverlay(true)
        setSaveOverlayDismissed(true)
      }

      if (nextIndex >= questions.length) {
        await supabase.from('sessions').update({ status: 'completed' }).eq('id', sessionId)
        setConversation(prev => [...prev, {
          role: 'assistant',
          content: `That's everything I need. Building your report now...`,
        }])
        setPhase('done')
        setTimeout(() => {
          window.location.href = `/results?session=${sessionId}`
        }, 2000)
      } else {
        await supabase.from('sessions').update({
          current_q_index: nextIndex,
          completed_summaries: updatedSummaries,
        }).eq('id', sessionId)

        const nextQ = questions[nextIndex]
        const transition = getTransition(tc)
        setConversation(prev => [...prev, {
          role: 'assistant',
          content: `${transition} Moving on.\n\n${nextQ.core_question}`,
        }])
        setQIndex(nextIndex)
      }
    } else {
      if (message && message.trim().length > 0) {
        const assistantMsg: Message = { role: 'assistant', content: message }
        setConversation(prev => [...prev, assistantMsg])
        await saveResponse(currentQ.id, [...newConv, assistantMsg])
      }
    }

    setLoading(false)
  }

  async function send() {
    if (!input.trim() || loading) return
    if (phase === 'intro') await sendIntro(input)
    else if (phase === 'interview') await sendInterview(input)
  }

  async function retryLastMessage() {
    if (!lastPayload.current) return
    setAiError(false)
    setLoading(true)

    let message: string
    let isComplete: boolean

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 40000)
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastPayload.current),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error('retry failed')
      const data = await res.json()
      message = data.message
      isComplete = data.isComplete
    } catch {
      setAiError(true)
      setLoading(false)
      return
    }

    const currentQ = questions[qIndex]
    if (isComplete) {
      await saveResponse(currentQ.id, conversation)
      if (qIndex + 1 >= questions.length) {
        await supabase.from('sessions').update({ status: 'completed' }).eq('id', sessionId)
        setConversation(prev => [...prev, { role: 'assistant', content: "That's everything — thank you. Building your report now..." }])
        setPhase('done')
        setTimeout(() => { window.location.href = `/results?session=${sessionId}` }, 2000)
      } else {
        const nextQ = questions[qIndex + 1]
        setConversation(prev => [...prev, { role: 'assistant', content: `Got it. Moving on.\n\n${nextQ.core_question}` }])
        setQIndex(qIndex + 1)
      }
    } else {
      setConversation(prev => [...prev, { role: 'assistant', content: message }])
    }

    setLoading(false)
    setAiError(false)
  }

  // ─── DERIVED ─────────────────────────────────────────────────────────────────

  const progress = questions.length > 0 ? Math.round((qIndex / questions.length) * 100) : 0

  // Build deduplicated category list — each unique category appears once, tracking all its indices
  type CatInfo = { name: string; minIdx: number; maxIdx: number }
  const categoryFlow: CatInfo[] = []
  if (questions.length > 0) {
    const seen = new Map<string, CatInfo>()
    questions.forEach((q, i) => {
      if (!q.category) return
      const existing = seen.get(q.category)
      if (existing) {
        existing.maxIdx = i
      } else {
        const entry = { name: q.category, minIdx: i, maxIdx: i }
        seen.set(q.category, entry)
        categoryFlow.push(entry)
      }
    })
  }

  // ─── SHARED STYLES ────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0C0C09', border: '1px solid #222218', borderRadius: 6,
    padding: '12px 14px', color: '#E8E0D0', fontFamily: 'monospace', fontSize: 14,
    outline: 'none', marginBottom: 10, boxSizing: 'border-box',
  }

  const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    width: '100%', background: disabled ? '#1A1A14' : '#C8A96E', border: 'none', borderRadius: 6,
    padding: '13px', color: disabled ? '#4A4A38' : '#0C0C09', fontFamily: 'monospace', fontSize: 14,
    fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, marginBottom: 10,
  })

  const ghostBtn: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none',
    padding: '8px', color: '#3A3A28', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
  }

  const cardWrap: React.CSSProperties = {
    minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontFamily: 'Georgia, serif', padding: '20px',
  }

  const card: React.CSSProperties = {
    background: '#111110', border: '1px solid #222218', borderRadius: 12,
    padding: '32px 28px', width: '100%', maxWidth: 420,
  }

  // ─── SET NEW PASSWORD (after clicking reset link in email) ────────────────────

  if (showSetNewPassword) {
    return (
      <div style={cardWrap}>
        <div style={card}>
          <div style={{ color: '#6A6A52', fontSize: 11, letterSpacing: '0.15em', fontFamily: 'monospace', marginBottom: 8 }}>ACCOUNT</div>
          <h2 style={{ color: '#E8E0D0', fontSize: 20, fontWeight: 400, marginBottom: 20 }}>Set a new password</h2>
          {authError && <div style={{ color: '#C07050', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>{authError}</div>}
          <input
            type="password"
            placeholder="New password (min. 6 characters)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetNewPassword()}
            style={inputStyle}
          />
          <button onClick={handleSetNewPassword} disabled={authLoading || newPassword.length < 6} style={primaryBtn(authLoading || newPassword.length < 6)}>
            {authLoading ? 'Saving...' : 'Set password →'}
          </button>
        </div>
      </div>
    )
  }

  // ─── START SCREEN ────────────────────────────────────────────────────────────

  if (phase === 'start') {
    return (
      <div style={cardWrap}>
        <div style={card}>
          <div style={{ color: '#6A6A52', fontSize: 11, letterSpacing: '0.15em', fontFamily: 'monospace', marginBottom: 8 }}>BUSINESS AUDIT</div>
          <h1 style={{ color: '#E8E0D0', fontSize: 24, fontWeight: 400, marginBottom: 8 }}>Diagnostic Interview</h1>
          <p style={{ color: '#6A6A52', fontSize: 13, fontFamily: 'monospace', marginBottom: 28, lineHeight: 1.6 }}>
            Goes deep into how your business actually works — maps exactly where you're leaving money on the table.
          </p>

          {resumableSession && !showSignIn && (
            <div style={{
              background: '#141410', border: '1px solid rgba(200,169,110,0.2)',
              borderRadius: 8, padding: '14px 16px', marginBottom: 16,
            }}>
              <div style={{ color: '#6A6A52', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', marginBottom: 6 }}>IN PROGRESS</div>
              <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 14, marginBottom: 10 }}>{resumableSession.business_name}</div>
              <button
                onClick={() => resumeSession(resumableSession)}
                style={{
                  width: '100%', background: '#1A1A12', border: '1px solid rgba(200,169,110,0.25)',
                  borderRadius: 6, padding: '10px', color: '#C8A96E',
                  fontFamily: 'monospace', fontSize: 13, cursor: 'pointer',
                }}
              >
                ↩ Continue this interview
              </button>
            </div>
          )}

          {!showSignIn ? (
            <>
              <input
                placeholder="What's your business called?"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSession()}
                style={inputStyle}
              />
              <button onClick={startSession} style={primaryBtn(false)}>Start →</button>
              {!user && (
                <button onClick={() => setShowSignIn(true)} style={{
                  width: '100%', background: 'transparent', border: '1px solid #1E1E14',
                  borderRadius: 6, padding: '11px', color: '#4A4A38',
                  fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
                }}>
                  ↩ Continue where you left off
                </button>
              )}
            </>
          ) : showForgotPassword ? (
            <>
              <div style={{ color: '#6A6A52', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', marginBottom: 12 }}>RESET PASSWORD</div>
              {authError && <div style={{ color: '#C07050', fontFamily: 'monospace', fontSize: 12, marginBottom: 10 }}>{authError}</div>}
              {forgotPasswordSent ? (
                <div style={{ color: '#7A9A7A', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                  Check your email — we've sent a reset link.
                </div>
              ) : (
                <>
                  <input placeholder="Your email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} style={inputStyle} />
                  <button onClick={handleForgotPassword} disabled={authLoading} style={primaryBtn(authLoading)}>
                    {authLoading ? 'Sending...' : 'Send reset link →'}
                  </button>
                </>
              )}
              <button onClick={() => { setShowForgotPassword(false); setForgotPasswordSent(false); setAuthError('') }} style={ghostBtn}>
                ← Back to sign in
              </button>
            </>
          ) : (
            <>
              <div style={{ color: '#6A6A52', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', marginBottom: 12 }}>SIGN IN TO RESUME</div>
              {authError && <div style={{ color: '#C07050', fontFamily: 'monospace', fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>{authError}</div>}
              <input placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} style={inputStyle} />
              <input
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                style={inputStyle}
              />
              <button onClick={() => handleSignIn()} disabled={authLoading} style={primaryBtn(authLoading)}>
                {authLoading ? 'Signing in...' : 'Sign in →'}
              </button>
              <button
                onClick={() => { setShowForgotPassword(true); setAuthError('') }}
                style={{ ...ghostBtn, marginBottom: 4 }}
              >
                Forgot password?
              </button>
              <button
                onClick={() => { setShowSignIn(false); setShowForgotPassword(false); setAuthError(''); setAuthEmail(''); setAuthPassword('') }}
                style={ghostBtn}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── CLASSIFYING ─────────────────────────────────────────────────────────────

  if (phase === 'classifying') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0C0C09', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '0 20px' }}>
          <div style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 13, marginBottom: 8 }}>Analysing your business...</div>
          <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 11 }}>Personalising the interview for you</div>
        </div>
      </div>
    )
  }


  // ─── INTERVIEW ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
    <SideNav sessionId={sessionId || undefined} />
    <div style={{
      flex: 1, minWidth: 0, background: '#0C0C09', display: 'flex', flexDirection: 'column',
      fontFamily: 'Georgia, serif', overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{
        background: '#0F0F0B', borderBottom: '1px solid #1A1A14',
        padding: '10px 16px', display: 'flex', alignItems: 'center',
        gap: 10, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ color: '#6A6A52', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.1em' }}>POCKET CMO</span>
        <span style={{ color: '#C8A96E', fontSize: 12, fontFamily: 'monospace' }}>{businessName}</span>
        {profile && (
          <span style={{
            fontSize: 10, fontFamily: 'monospace', color: '#3A3A28',
            background: '#141410', border: '1px solid #1E1E14',
            borderRadius: 4, padding: '2px 7px',
          }}>
            {profile.industry} · {profile.business_type}
          </span>
        )}
        {user ? (
          <span style={{
            fontSize: 10, fontFamily: 'monospace', color: '#4A6A4A',
            background: '#101410', border: '1px solid #1A2A1A',
            borderRadius: 4, padding: '2px 7px',
          }}>
            ✓ saving
          </span>
        ) : saveOverlayDismissed && (
          <button
            onClick={() => setShowSaveOverlay(true)}
            style={{
              fontSize: 10, fontFamily: 'monospace', color: '#8A5A30',
              background: '#1A1008', border: '1px solid rgba(180,100,30,0.3)',
              borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
            }}
          >
            ⚠ save progress
          </button>
        )}
        {phase === 'interview' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 80, height: 3, background: '#1A1A14', borderRadius: 2 }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#C8A96E', borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#4A4A38' }}>{qIndex}/{questions.length}</span>
          </div>
        )}
      </div>

      {/* Category flow strip */}
      {phase === 'interview' && categoryFlow.length > 1 && (
        <div style={{
          background: '#0A0A07', borderBottom: '1px solid #111110',
          padding: '6px 16px', display: 'flex', gap: 4, overflowX: 'auto',
          flexShrink: 0, alignItems: 'center',
        }}>
          {categoryFlow.map((cat, i) => {
            const isDone = qIndex > cat.maxIdx
            const isCurrent = questions[qIndex]?.category === cat.name
            return (
              <span key={i} style={{
                fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
                padding: '3px 8px', borderRadius: 3, whiteSpace: 'nowrap',
                color: isDone ? '#4A4A38' : isCurrent ? '#C8A96E' : '#222218',
                background: isCurrent ? 'rgba(200,169,110,0.07)' : 'transparent',
                border: `1px solid ${isCurrent ? 'rgba(200,169,110,0.18)' : '#161612'}`,
                transition: 'all 0.3s',
              }}>
                {isDone ? '✓ ' : ''}{cat.name.toUpperCase()}
              </span>
            )
          })}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {conversation.map((msg, i) => (
            <div key={i} style={{
              marginBottom: 16, display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%',
                background: msg.role === 'user' ? '#1A1A12' : '#111110',
                border: `1px solid ${msg.role === 'user' ? '#2A2A1E' : '#1A1A14'}`,
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                padding: '12px 16px', color: '#D0C8B8', fontSize: 15,
                lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && !aiError && (
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ background: '#111110', border: '1px solid #1A1A14', borderRadius: '16px 16px 16px 4px', padding: '12px 16px' }}>
                <span style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 12 }}>thinking...</span>
              </div>
            </div>
          )}
          {aiError && (
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                background: '#131208', border: '1px solid rgba(180,120,40,0.25)',
                borderRadius: '16px 16px 16px 4px', padding: '14px 18px',
                maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <span style={{ color: '#9A8060', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.55 }}>
                  Sorry — that took longer than expected. Your answers are saved. Pick up right where you left off.
                </span>
                <button onClick={retryLastMessage} style={{
                  alignSelf: 'flex-start', background: '#C8A96E', border: 'none', borderRadius: 6,
                  padding: '7px 14px', color: '#0C0C09', fontFamily: 'monospace', fontSize: 12,
                  fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em',
                }}>
                  ↩ Continue where I left off
                </button>
              </div>
            </div>
          )}
          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#7EB8A4', fontFamily: 'monospace', fontSize: 12 }}>
              ✓ Redirecting to your report...
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Save progress overlay */}
      {showSaveOverlay && !user && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(12,12,9,0.93)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200, padding: 20,
        }}>
          <div style={{
            background: '#111110', border: '1px solid #2A2018',
            borderRadius: 12, padding: '32px 28px', width: '100%', maxWidth: 420,
          }}>
            <div style={{ color: '#C07050', fontSize: 11, letterSpacing: '0.15em', fontFamily: 'monospace', marginBottom: 8 }}>⚠ YOUR DATA IS NOT SAVED</div>
            <h2 style={{ color: '#E8E0D0', fontSize: 20, fontWeight: 400, marginBottom: 12 }}>Save your progress</h2>
            <p style={{ color: '#6A6A4A', fontSize: 13, fontFamily: 'monospace', lineHeight: 1.75, marginBottom: 20 }}>
              Everything you've answered so far exists only in this browser tab. A page refresh, network error, or browser crash will permanently delete all of it — there is no recovery. Create a free account and your progress is saved after every answer.
            </p>

            {authError && <div style={{ color: '#C07050', fontFamily: 'monospace', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{authError}</div>}

            {overlayMode === 'signup' ? (
              <>
                <input placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} style={inputStyle} />
                <input
                  type="password"
                  placeholder="Password (min. 6 characters)"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignUp()}
                  style={inputStyle}
                />
                <button onClick={handleSignUp} disabled={authLoading} style={primaryBtn(authLoading)}>
                  {authLoading ? 'Saving...' : 'Create account & save progress →'}
                </button>
                <button onClick={() => { setOverlayMode('signin'); setAuthError('') }} style={ghostBtn}>
                  Already have an account? Sign in
                </button>
              </>
            ) : (
              <>
                <input placeholder="Email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} style={inputStyle} />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSignIn(true)}
                  style={inputStyle}
                />
                <button onClick={() => handleSignIn(true)} disabled={authLoading} style={primaryBtn(authLoading)}>
                  {authLoading ? 'Signing in...' : 'Sign in & save progress →'}
                </button>
                <button onClick={() => { setOverlayMode('signup'); setAuthError('') }} style={ghostBtn}>
                  New here? Create an account
                </button>
              </>
            )}

            <div style={{ height: 1, background: '#1A1A14', margin: '8px 0 12px' }} />
            <button
              onClick={() => { setShowSaveOverlay(false); setSaveOverlayDismissed(true) }}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                padding: '8px', color: '#2E2E1E', fontFamily: 'monospace', fontSize: 11,
                cursor: 'pointer', lineHeight: 1.6, textAlign: 'center',
              }}
            >
              I understand — I'll risk losing my data
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      {(phase === 'intro' || phase === 'interview') && (
        <div style={{ borderTop: '1px solid #1A1A14', padding: '12px 16px', background: '#0F0F0B', flexShrink: 0 }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder="Type your answer..."
              rows={2}
              style={{
                flex: 1, background: '#111110', border: '1px solid #222218',
                borderRadius: 10, padding: '10px 14px', color: '#E8E0D0',
                fontFamily: 'monospace', fontSize: 14, outline: 'none',
                resize: 'none', lineHeight: 1.5, WebkitAppearance: 'none',
              }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              style={{
                background: loading || !input.trim() ? '#1A1A14' : '#C8A96E',
                border: 'none', borderRadius: 10, padding: '0 18px',
                color: loading || !input.trim() ? '#4A4A38' : '#0C0C09',
                fontFamily: 'monospace', fontSize: 13, fontWeight: 500,
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                minWidth: 64, flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
