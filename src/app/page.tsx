'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import SideNav from '@/components/SideNav'
import FeedbackButton from '@/components/FeedbackButton'

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
  has_employees?: boolean
}

type Phase = 'start' | 'intro' | 'classifying' | 'interview' | 'done'

type CatInfo = { name: string; minIdx: number; maxIdx: number }

function detectPivotIntent(
  message: string,
  catFlow: CatInfo[],
  currentQIdx: number,
  qs: Question[]
): { categoryName: string; firstQIndex: number } | null {
  const REDIRECT = [
    "let's focus", "focus on", "let's talk about", "talk about",
    "let's start with", "start with", "switch to", "move to",
    "can we discuss", "prioritize", "my main issue", "biggest problem",
    "main problem", "let's cover", "most important", "start from",
    "begin with", "tackle first", "actually want to", "can we start with",
  ]
  const lower = message.toLowerCase()
  if (!REDIRECT.some(p => lower.includes(p))) return null

  const target = catFlow.find(cat =>
    lower.includes(cat.name.toLowerCase()) && cat.minIdx > currentQIdx
  )
  if (!target) return null

  const firstQIndex = qs.findIndex((q, i) => i >= target.minIdx && q.category === target.name)
  if (firstQIndex === -1) return null
  return { categoryName: target.name, firstQIndex }
}

const INTRO_OPENER = `Tell me about your business like you're explaining it to someone you just met — what do you do, who do you do it for, and what's the thing you're most proud of?\n\nFeel free to answer in your own language if that's easier.`

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: 'EN' },
  { code: 'nl', flag: '🇳🇱', label: 'NL' },
  { code: 'other', flag: '✏', label: 'Other' },
]

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
  const [completedSummaries, setCompletedSummaries] = useState<{ question: string; summary: string; data_backed?: boolean | null }[]>([])
  const [introTurns, setIntroTurns] = useState(0)
  const [transitionCount, setTransitionCount] = useState(0)
  const [aiError, setAiError] = useState(false)
  const [language, setLanguage] = useState('en')
  const [customLanguage, setCustomLanguage] = useState('')
  const lastPayload = useRef<object | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tokenTotals = useRef({ input: 0, output: 0 })
  // Counts every Claude API response (not just completed questions) — used to trigger save overlay
  const claudeResponsesRef = useRef(0)

  function trackUsage(usage: { input_tokens?: number; output_tokens?: number } | null | undefined) {
    if (!usage) return
    tokenTotals.current.input += usage.input_tokens ?? 0
    tokenTotals.current.output += usage.output_tokens ?? 0
  }

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
  const [authChecked, setAuthChecked] = useState(false)
  const [authError, setAuthError] = useState('')
  const [interviewTransition, setInterviewTransition] = useState('')
  const [showSaveOverlay, setShowSaveOverlay] = useState(false)
  const [saveOverlayDismissed, setSaveOverlayDismissed] = useState(false)
  const [overlayMode, setOverlayMode] = useState<'signup' | 'signin'>('signup')
  const [saveBarDismissed, setSaveBarDismissed] = useState(false)
  const [resumeIdFromUrl, setResumeIdFromUrl] = useState<string | null>(null)
  const [answeredIds, setAnsweredIds] = useState<string[]>([])

  // Read ?resume=SESSION_ID from URL on mount and clean up the URL immediately
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('resume')
    if (id) {
      setResumeIdFromUrl(id)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Once auth is confirmed and questions are loaded, resume the session from the link
  useEffect(() => {
    if (!resumeIdFromUrl || !authChecked || allQuestions.length === 0 || phase !== 'start') return
    const id = resumeIdFromUrl
    setResumeIdFromUrl(null)
    supabase
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!data) return
        sessionStorage.setItem('audit_session_id', data.id)
        resumeSession(data)
      })
  }, [resumeIdFromUrl, authChecked, allQuestions, phase])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('questions')
        .select('*, follow_ups(text, sort_order)')
        .eq('active', true)
        .order('sort_order')
      if (data) setAllQuestions(data)
    }
    load()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, introConversation])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { setUser(user ?? null); setAuthChecked(true) })
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
      .then(({ data }) => {
        if (!data) return
        // If returning from the dashboard, auto-resume immediately without flashing the banner
        const flag = sessionStorage.getItem('autoResume')
        if (flag) {
          sessionStorage.removeItem('autoResume')
          resumeSession(data)
        } else {
          setResumableSession(data)
        }
      })
  }, [user, allQuestions, phase])

  // Auto-resume (anonymous) when returning from the dashboard
  useEffect(() => {
    if (phase !== 'start' || !authChecked || user || allQuestions.length === 0) return
    const flag = sessionStorage.getItem('autoResume')
    if (!flag) return
    const anonId = sessionStorage.getItem('audit_session_id')
    if (!anonId) return
    sessionStorage.removeItem('autoResume')
    supabase
      .from('sessions')
      .select('*')
      .eq('id', anonId)
      .single()
      .then(({ data }) => { if (data) resumeSession(data) })
  }, [user, authChecked, allQuestions, phase])

  async function startSession() {
    if (!businessName.trim() || allQuestions.length === 0) return
    // Reset all interview-specific state so a new session always starts clean
    setCompletedSummaries([])
    setQIndex(0)
    setQuestions([])
    setProfile(null)
    setIntroTurns(0)
    setTransitionCount(0)
    setSaveOverlayDismissed(false)
    setShowSaveOverlay(false)
    setSaveBarDismissed(false)
    setAiError(false)
    setOverlayMode('signup')
    setInput('')
    tokenTotals.current = { input: 0, output: 0 }
    claudeResponsesRef.current = 0
    const { data } = await supabase
      .from('sessions')
      .insert({ business_name: businessName, status: 'intro', user_id: user?.id ?? null, language: effectiveLanguage })
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
      trackUsage(json.usage)
    } catch {
      setAiError(true)
      setPhase('interview')
      return
    }
    setProfile(detectedProfile)
    setAnsweredIds([])

    await supabase.from('sessions').update({
      business_description: detectedProfile.business_description,
      business_type: detectedProfile.business_type,
      industry: detectedProfile.industry,
      awareness_level: detectedProfile.awareness_level,
      owner_tone: detectedProfile.owner_tone,
      has_employees: detectedProfile.has_employees ?? null,
      answered_ids: [],
      status: 'in_progress',
    }).eq('id', sessionId)

    const filtered = allQuestions.filter(q => {
      if (detectedProfile.skip_questions?.includes(q.id)) return false
      if (!q.applies_to || q.applies_to.length === 0) return true
      if (q.applies_to.includes('has_employees') && !detectedProfile.has_employees) return false
      if (q.applies_to.includes('all')) return true
      if (q.applies_to.includes('has_employees') && detectedProfile.has_employees) return true
      return q.applies_to.includes(detectedProfile.business_type)
    })

    // Front-load emphasis areas if the owner already named a concern in the intro
    let orderedQuestions = filtered
    if (detectedProfile.emphasis_areas?.length > 0) {
      const empCats = new Set(
        (detectedProfile.emphasis_areas as string[]).map(a => a.toLowerCase())
      )
      const priority = filtered.filter(q => empCats.has((q.category || '').toLowerCase()))
      const rest = filtered.filter(q => !empCats.has((q.category || '').toLowerCase()))
      orderedQuestions = [...priority, ...rest]
    }

    setQuestions(orderedQuestions)

    const awarenessLine = detectedProfile.awareness_level === 'knows_the_gap'
      ? `You already have a sense of where the gaps are — let's see if the numbers back that up.`
      : detectedProfile.awareness_level === 'has_a_hunch'
      ? `You have a hunch something's off — let's dig into where exactly.`
      : `Let's map out the full picture and find where the opportunities are hiding.`

    const transition = `Got it — that's really helpful context. ${awarenessLine}\n\nDepending on how complex your business is, this usually takes between 1 and 1.5 hours. Some questions will feel obvious, some might surprise you. Just answer honestly — that's what makes this useful.\n\n${orderedQuestions[0].core_question}`

    claudeResponsesRef.current += 1
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
    if (session.language) {
      if (session.language === 'English') { setLanguage('en') }
      else if (session.language === 'Dutch') { setLanguage('nl') }
      else { setLanguage('other'); setCustomLanguage(session.language) }
    }
    const restoredProfile: BusinessProfile = {
      business_description: session.business_description || '',
      business_type: session.business_type || '',
      industry: session.industry || '',
      awareness_level: session.awareness_level || '',
      owner_tone: session.owner_tone || '',
      first_name: null,
      skip_questions: [],
      emphasis_areas: [],
      has_employees: session.has_employees ?? undefined,
    }
    setProfile(restoredProfile)

    const filtered = allQuestions.filter(q => {
      if (!q.applies_to || q.applies_to.length === 0) return true
      if (q.applies_to.includes('has_employees') && session.has_employees === false) return false
      if (q.applies_to.includes('all')) return true
      if (q.applies_to.includes('has_employees') && session.has_employees) return true
      if (q.applies_to.includes('has_employees')) return true // null = unknown, include
      return q.applies_to.includes(session.business_type)
    })
    setQuestions(filtered)

    const summaries = session.completed_summaries || []
    setCompletedSummaries(summaries)

    // answered_ids is the source of truth for which questions this session has covered.
    // For legacy sessions without it, derive from completed_summaries by matching question text
    // back to question IDs — more reliable than the responses table which can have gaps.
    // We work at category level: if any question in a category appears in completed_summaries,
    // mark the whole category as done. This handles sessions that skipped early questions via pivot.
    let knownAnsweredIds: string[] = session.answered_ids || []
    if (knownAnsweredIds.length === 0 && summaries.length > 0) {
      const summaryTexts = new Set(summaries.map((s: any) => s.question))
      const textMatchedQs = allQuestions.filter(q => summaryTexts.has(q.core_question))
      if (textMatchedQs.length > 0) {
        // Mark entire categories as done if any question in them was answered
        const doneCategories = new Set(textMatchedQs.map(q => q.category))
        knownAnsweredIds = filtered
          .filter(q => doneCategories.has(q.category))
          .map(q => q.id)
      } else {
        // No text matches at all — fall back to positional assumption
        knownAnsweredIds = filtered.slice(0, summaries.length).map(q => q.id)
      }
    }
    setAnsweredIds(knownAnsweredIds)

    const answeredIdSet = new Set(knownAnsweredIds)
    const firstUnansweredIdx = filtered.findIndex(q => !answeredIdSet.has(q.id))
    const qIdx = firstUnansweredIdx === -1 ? Math.max(0, filtered.length - 1) : firstUnansweredIdx
    setQIndex(qIdx)

    // Reopen completed sessions that now have new unanswered questions
    if ((session.status === 'completed' || session.status === 'interview_done') && firstUnansweredIdx !== -1) {
      await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', session.id)
    }

    const currentQ = filtered[qIdx]
    let resumeConv: Message[] = []

    // Load in-progress conversation for the current question from sessionStorage
    const cached = sessionStorage.getItem(`conv_${session.id}`)
    if (cached) {
      try {
        const parsed: Message[] = JSON.parse(cached)
        // Only restore if the last assistant message was for this question (not an old one)
        if (parsed && parsed.length > 0) {
          resumeConv = [...parsed, { role: 'assistant' as const, content: `Welcome back. Let's continue.` }]
        }
      } catch { /* fall through */ }
    }

    // Fall back to Supabase: load in-progress conversation for the current question only
    if (resumeConv.length === 0 && currentQ) {
      const { data: currentResp } = await supabase
        .from('responses')
        .select('conversation')
        .eq('session_id', session.id)
        .eq('question_id', currentQ.id)
        .single()
      if (currentResp && currentResp.conversation?.length > 0) {
        resumeConv = [
          ...currentResp.conversation,
          { role: 'assistant' as const, content: `Welcome back. Let's continue.` },
        ]
      }
    }

    // No in-progress conversation found — this is a fresh question for this session.
    // Show a clean welcome rather than loading history from a previous question.
    if (resumeConv.length === 0 && currentQ) {
      const movingToNewArea = answeredIdSet.size > 0 && !answeredIdSet.has(currentQ.id)
      resumeConv = [{
        role: 'assistant' as const,
        content: movingToNewArea
          ? `Welcome back! We've added some new areas to the diagnostic since you were last here. Let's pick up where the gaps are.\n\n${currentQ.core_question}`
          : `Welcome back to ${session.business_name}. Let's continue.\n\n${currentQ.core_question}`,
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
    summaries: { question: string; summary: string; data_backed?: boolean | null }[]
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
    const precheckData = await res.json()
    trackUsage(precheckData.usage)
    return precheckData.covered === true
  }

  async function handleCategoryPivot(cat: CatInfo) {
    if (loading || phase !== 'interview') return
    const firstQIndex = questions.findIndex((q, i) => i >= cat.minIdx && q.category === cat.name)
    if (firstQIndex === -1 || firstQIndex === qIndex) return
    const currentQ = questions[qIndex]
    await saveResponse(currentQ.id, [])
    const updatedAnsweredIdsPivot = [...answeredIds, currentQ.id]
    setAnsweredIds(updatedAnsweredIdsPivot)
    const pivotMsg = `Let's shift to ${cat.name}.\n\n${questions[firstQIndex].core_question}`
    setConversation(prev => [...prev, { role: 'assistant', content: pivotMsg }])
    if (sessionId) {
      await supabase.from('sessions').update({
        current_q_index: firstQIndex,
        completed_summaries: completedSummaries,
        answered_ids: updatedAnsweredIdsPivot,
      }).eq('id', sessionId)
    }
    setQIndex(firstQIndex)
  }

  async function sendInterview(userInput: string) {
    const currentQ = questions[qIndex]
    const userMsg: Message = { role: 'user', content: userInput }

    // Check for pivot intent before hitting the API
    const pivotTarget = detectPivotIntent(userInput, categoryFlow, qIndex, questions)
    if (pivotTarget) {
      setConversation(prev => [...prev, userMsg])
      setInput('')
      setLoading(true)
      await saveResponse(currentQ.id, [])
      const updatedAnsweredIdsDetect = [...answeredIds, currentQ.id]
      setAnsweredIds(updatedAnsweredIdsDetect)
      const pivotMsg = `Sure — let's focus on ${pivotTarget.categoryName} first.\n\n${questions[pivotTarget.firstQIndex].core_question}`
      setConversation(prev => [...prev, { role: 'assistant', content: pivotMsg }])
      if (sessionId) {
        await supabase.from('sessions').update({
          current_q_index: pivotTarget.firstQIndex,
          completed_summaries: completedSummaries,
          answered_ids: updatedAnsweredIdsDetect,
        }).eq('id', sessionId)
      }
      setQIndex(pivotTarget.firstQIndex)
      setLoading(false)
      return
    }

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
      language: effectiveLanguage,
    }
    lastPayload.current = payload

    let message: string
    let isComplete: boolean
    let dataBacked: boolean | null = null

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
      dataBacked = data.dataBacked ?? null
      trackUsage(data.usage)
    } catch {
      setAiError(true)
      setLoading(false)
      return
    }

    if (isComplete) {
      await saveResponse(currentQ.id, newConv)
      const ownerReplies = newConv.filter(m => m.role === 'user').map(m => m.content).join(' / ')
      const newSummary = { question: currentQ.core_question, summary: ownerReplies, data_backed: dataBacked }
      const updatedSummaries = [...completedSummaries, newSummary]
      setCompletedSummaries(updatedSummaries)

      // Track answered question IDs — this is the source of truth for resume position
      let updatedAnsweredIds = [...answeredIds, currentQ.id]

      let nextIndex = qIndex + 1
      while (nextIndex < questions.length) {
        const candidate = questions[nextIndex]
        const alreadyCovered = await checkIfAlreadyCovered(candidate, updatedSummaries)
        if (!alreadyCovered) break
        await saveResponse(candidate.id, [])
        updatedAnsweredIds = [...updatedAnsweredIds, candidate.id]
        nextIndex++
      }
      setAnsweredIds(updatedAnsweredIds)

      const tc = transitionCount
      setTransitionCount(tc + 1)

      if (nextIndex >= questions.length) {
        claudeResponsesRef.current += 1
        await supabase.from('sessions').update({ status: 'interview_done', answered_ids: updatedAnsweredIds }).eq('id', sessionId)
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
          answered_ids: updatedAnsweredIds,
        }).eq('id', sessionId)

        const nextQ = questions[nextIndex]
        const transition = getTransition(tc)
        const transitionMsg: Message = { role: 'assistant', content: `${transition} Moving on.\n\n${nextQ.core_question}` }
        const updatedConv = [...newConv, transitionMsg]
        setConversation(prev => [...prev, transitionMsg])
        if (sessionId) sessionStorage.setItem(`conv_${sessionId}`, JSON.stringify(updatedConv))
        setQIndex(nextIndex)

        // Count this API response and show save overlay at the 5th response (once only)
        claudeResponsesRef.current += 1
        if (claudeResponsesRef.current >= 5 && !user && !saveOverlayDismissed) {
          setShowSaveOverlay(true)
          setSaveOverlayDismissed(true)
        }
      }
    } else {
      if (message && message.trim().length > 0) {
        const assistantMsg: Message = { role: 'assistant', content: message }
        const updatedConv = [...newConv, assistantMsg]
        setConversation(prev => [...prev, assistantMsg])
        await saveResponse(currentQ.id, updatedConv)
        if (sessionId) sessionStorage.setItem(`conv_${sessionId}`, JSON.stringify(updatedConv))

        // Count this API response and show save overlay at the 5th response (once only)
        claudeResponsesRef.current += 1
        if (claudeResponsesRef.current >= 5 && !user && !saveOverlayDismissed) {
          setShowSaveOverlay(true)
          setSaveOverlayDismissed(true)
        }
      }
    }

    setLoading(false)
  }

  async function handleSummarize() {
    if (completedSummaries.length === 0) {
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: "We haven't covered anything in depth yet — just answer the questions as we go and I'll build up the picture.",
      }])
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, completedSummaries, language: effectiveLanguage }),
      })
      const sumData = await res.json()
      trackUsage(sumData.usage)
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: sumData.summary || "We've covered a number of areas — keep going to build the full picture.",
      }])
    } catch {
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: "Couldn't generate a summary right now — try again in a moment.",
      }])
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
        await supabase.from('sessions').update({ status: 'interview_done' }).eq('id', sessionId)
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

  const effectiveLanguage = language === 'en' ? 'English'
    : language === 'nl' ? 'Dutch'
    : customLanguage.trim() || 'English'

  const progress = questions.length > 0 ? Math.round((qIndex / questions.length) * 100) : 0

  // Build deduplicated category list — each unique category appears once, tracking all its indices
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
          <p style={{ color: '#6A6A52', fontSize: 13, fontFamily: 'monospace', marginBottom: 20, lineHeight: 1.6 }}>
            Goes deep into how your business actually works — maps exactly where you're leaving money on the table.
          </p>

          {/* Language picker */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ color: '#3A3A28', fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.1em', marginBottom: 8 }}>LANGUAGE</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  style={{
                    background: language === l.code ? 'rgba(200,169,110,0.1)' : 'transparent',
                    border: `1px solid ${language === l.code ? 'rgba(200,169,110,0.4)' : '#1E1E14'}`,
                    borderRadius: 6, padding: '7px 13px', cursor: 'pointer',
                    color: language === l.code ? '#C8A96E' : '#3A3A28',
                    fontFamily: 'monospace', fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all 0.15s',
                  }}
                >
                  {l.flag} {l.label}
                </button>
              ))}
            </div>
            {language === 'other' && (
              <input
                placeholder="e.g. French, Spanish, German..."
                value={customLanguage}
                onChange={e => setCustomLanguage(e.target.value)}
                style={{ ...inputStyle, marginTop: 8, marginBottom: 0 }}
              />
            )}
          </div>

          {resumableSession && !showSignIn && authChecked && (
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
              {!user && authChecked && (
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
    <>
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
    <SideNav
      sessionId={sessionId || undefined}
      isAnon={!user && (phase === 'interview' || phase === 'intro')}
      onSave={() => setShowSaveOverlay(true)}
    />
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
        ) : (
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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {typeof window !== 'undefined' && window.location.search.includes('debug=1') && (
              <span style={{
                fontSize: 9, fontFamily: 'monospace', color: '#4A6A4A',
                background: '#0A120A', border: '1px solid #1A2A1A',
                borderRadius: 4, padding: '2px 7px', letterSpacing: '0.04em',
              }}>
                ↑{tokenTotals.current.input.toLocaleString()} ↓{tokenTotals.current.output.toLocaleString()} tok
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 80, height: 3, background: '#1A1A14', borderRadius: 2 }}>
                <div style={{ width: `${progress}%`, height: '100%', background: '#C8A96E', borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#4A4A38' }}>{qIndex}/{questions.length}</span>
            </div>
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
            // A category is done only when at least one of its questions has a completed summary
            const catQTexts = new Set(
              questions.filter(q => q.category === cat.name).map(q => q.core_question)
            )
            const isDone = completedSummaries.some(s => catQTexts.has(s.question))
            const isCurrent = questions[qIndex]?.category === cat.name
            // Upcoming: not yet reached positionally
            const isUpcoming = !isDone && !isCurrent && cat.minIdx > qIndex
            // Skipped: positionally passed via pivot but never answered
            const isSkipped = !isDone && !isCurrent && cat.maxIdx < qIndex
            const isClickable = isUpcoming || isSkipped
            return (
              <span
                key={i}
                onClick={isClickable ? () => handleCategoryPivot(cat) : undefined}
                title={isUpcoming ? `Jump to ${cat.name}` : isSkipped ? `Return to ${cat.name}` : undefined}
                style={{
                  fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
                  padding: '3px 8px', borderRadius: 3, whiteSpace: 'nowrap',
                  color: isDone ? '#4A4A38' : isCurrent ? '#C8A96E' : isClickable ? '#5A5A3E' : '#2A2A1E',
                  background: isCurrent ? 'rgba(200,169,110,0.07)' : 'transparent',
                  border: `1px solid ${isCurrent ? 'rgba(200,169,110,0.18)' : isClickable ? '#2A2A1E' : '#161612'}`,
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { if (isClickable) { (e.currentTarget as HTMLElement).style.color = '#C8A96E'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,110,0.3)' } }}
                onMouseLeave={e => { if (isClickable) { (e.currentTarget as HTMLElement).style.color = '#5A5A3E'; (e.currentTarget as HTMLElement).style.borderColor = '#2A2A1E' } }}
              >
                {isDone ? '✓ ' : isSkipped ? '→ ' : ''}{cat.name.toUpperCase()}
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

      {/* Input */}
      {(phase === 'intro' || phase === 'interview') && (
        <div style={{ borderTop: '1px solid #1A1A14', padding: '12px 16px', background: '#0F0F0B', flexShrink: 0 }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
          {phase === 'interview' && completedSummaries.length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSummarize}
                style={{
                  background: 'transparent', border: '1px solid #1E1E14',
                  borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
                  color: '#3A3A28', fontFamily: 'monospace', fontSize: 10,
                  letterSpacing: '0.06em',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(200,169,110,0.3)'
                  e.currentTarget.style.color = '#C8A96E'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#1E1E14'
                  e.currentTarget.style.color = '#3A3A28'
                }}
              >
                ↻ What have we covered?
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
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
        </div>
      )}

      {/* Persistent save bar — always visible during interview for non-logged-in users */}
      {!user && phase === 'interview' && !saveBarDismissed && !showSaveOverlay && (
        <div style={{
          flexShrink: 0, background: '#0F0F0B', borderTop: '1px solid rgba(200,120,50,0.2)',
          padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <button
            onClick={() => setShowSaveOverlay(true)}
            style={{
              flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#9A6030', fontFamily: 'monospace', fontSize: 11,
              textAlign: 'left', letterSpacing: '0.03em', padding: 0, lineHeight: 1.4,
            }}
          >
            ⚠ Your progress isn't saved — tap to create a free account
          </button>
          <button
            onClick={() => setSaveBarDismissed(true)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#3A3A28', fontFamily: 'monospace', fontSize: 16,
              padding: '0 4px', flexShrink: 0, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
    </div>

    {/* Save progress overlay — rendered OUTSIDE all overflow:hidden containers so iOS Safari
        position:fixed works relative to the viewport, not the containing block */}
    {showSaveOverlay && !user && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(12,12,9,0.93)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
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

    {(phase === 'intro' || phase === 'interview' || phase === 'done') && (
      <FeedbackButton
        sessionId={sessionId}
        context={{
          phase,
          currentQuestion: questions[qIndex]?.id ?? null,
          currentQuestionText: questions[qIndex]?.core_question ?? null,
          answeredCount: answeredIds.length,
          totalQuestions: questions.length,
          businessName,
          businessType: profile?.business_type ?? null,
        }}
      />
    )}
    </>
  )
}
