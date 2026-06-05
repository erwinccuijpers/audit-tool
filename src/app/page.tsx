'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import ClientNav from '@/components/ClientNav'
import FeedbackButton from '@/components/FeedbackButton'
import { addSessionUsage } from '@/lib/usage'

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

type Phase = 'start' | 'intro' | 'classifying' | 'interview' | 'referral' | 'done'

// ── Pillar-mode types ──────────────────────────────────────────────────────────
const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people'] as const
type PillarName = typeof PILLAR_ORDER[number]

const PILLAR_LABELS: Record<PillarName, string> = {
  positioning: 'Positioning',
  acquisition: 'Acquisition',
  retention:   'Retention',
  revenue:     'Revenue',
  strategy:    'Strategy',
  tools:       'Tools & Systems',
  people:      'People',
}

const PILLAR_TRANSITIONS: Record<string, string> = {
  'positioning→acquisition': "Good. Now let's look at how you bring in new clients.",
  'acquisition→retention':   "Got it. Let's shift to how you keep the clients you have.",
  'retention→revenue':       "Thanks. Now let's dig into the revenue picture.",
  'revenue→strategy':        "Helpful. Let's zoom out and talk about where the business is going.",
  'strategy→tools':          "Good. Now let's go through the tools and systems you're working with.",
  'tools→people':            "Almost done. Last section — let's talk about your team.",
}

type PillarQuestion = {
  id: string
  coreQuestion: string
  toolNote: string | null
  followUps: string[]
}

type PillarSummary = {
  contextSummary: string
  entities: { tools: string[]; numbers: string[]; competitors: string[]; flags: string[] }
  confidence: number
  situation: string
  recommendation: string
  dataGaps: string[]
  completedAt: string
  dataBacked: boolean | null
  conversation?: { role: 'user' | 'assistant'; content: string }[]
}

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

const INTRO_OPENER = `Tell me about your business like you're explaining it to someone you just met — what do you do, who do you do it for, and what's the thing you're most proud of?`

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
  const lastPillarPayload = useRef<object | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tokenTotals = useRef({ input: 0, output: 0 })
  // Counts every Claude API response (not just completed questions) — used to trigger save overlay
  const claudeResponsesRef = useRef(0)

  // ── Pillar-mode state ────────────────────────────────────────────────────────
  const [pillarMode, setPillarMode] = useState(false)
  const [currentPillarIndex, setCurrentPillarIndex] = useState(0)
  const [pillarSummaries, setPillarSummaries] = useState<Record<string, PillarSummary>>({})
  const [pillarQuestions, setPillarQuestions] = useState<Record<string, PillarQuestion[]>>({})
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const pillarSummariesRef = useRef<Record<string, PillarSummary>>({})
  // Keep ref in sync so async callbacks always have latest value
  useEffect(() => { pillarSummariesRef.current = pillarSummaries }, [pillarSummaries])

  function trackUsage(usage: { input_tokens?: number; output_tokens?: number } | null | undefined) {
    if (!usage) return
    tokenTotals.current.input += usage.input_tokens ?? 0
    tokenTotals.current.output += usage.output_tokens ?? 0
  }

  // How much usage has already been written to the DB this page-load. Lets us
  // persist cost incrementally (the delta) after every turn instead of one lump
  // at completion — so abandoned/in-progress sessions still carry their cost-so-far.
  const persistedTokens = useRef({ input: 0, output: 0 })
  async function flushUsage(id: string | null = sessionId) {
    if (!id) return
    const dIn = tokenTotals.current.input - persistedTokens.current.input
    const dOut = tokenTotals.current.output - persistedTokens.current.output
    if (dIn <= 0 && dOut <= 0) return
    persistedTokens.current = { input: tokenTotals.current.input, output: tokenTotals.current.output }
    await addSessionUsage(id, { input_tokens: dIn, output_tokens: dOut })
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
  const [utmParams, setUtmParams] = useState<Record<string, string>>({})
  // ?test=1 in the URL tags this session as demo/test data so it stays out of real stats
  const [isTest, setIsTest] = useState(false)
  // Auto-dashboard notification state
  const [dashboardNotif, setDashboardNotif] = useState<'idle' | 'creating' | 'ready'>('idle')
  const [dashboardNotifStage, setDashboardNotifStage] = useState<'first' | 'halfway'>('first')
  const dashboardAutoFiredRef = useRef(false)
  const halfwayAutoFiredRef = useRef(false)
  // Refs for stale-closure safety inside the 15-min timer
  const completedSummariesRef = useRef(completedSummaries)
  const questionsRef = useRef(questions)
  const profileRef = useRef(profile)
  const businessNameRef = useRef(businessName)
  const sessionIdRef = useRef(sessionId)
  const languageRef = useRef(language)
  const customLanguageRef = useRef(customLanguage)
  const phaseRef = useRef(phase)
  // Tracks where the current question started in the conversation array.
  // Used to extract only this question's user replies for raw_answer in the transcript.
  const questionConvStartRef = useRef(0)

  // Read ?resume=SESSION_ID and UTM params from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('resume')
    if (id) {
      setResumeIdFromUrl(id)
      window.history.replaceState({}, '', window.location.pathname)
    }
    const utm: Record<string, string> = {}
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const v = params.get(key)
      if (v) utm[key] = v
    }
    if (Object.keys(utm).length > 0) setUtmParams(utm)
    if (params.get('test') === '1') setIsTest(true)
  }, [])

  // Once auth is confirmed and questions are loaded, resume the session from the link.
  // On a cold load the auth token may not be attached to the supabase client yet, so an
  // RLS-protected read can transiently return no row. Retry a few times and only clear the
  // resume id once the read actually succeeds — otherwise the link silently lands the user
  // on a blank start screen and they have to paste it again.
  useEffect(() => {
    if (!resumeIdFromUrl || !authChecked || allQuestions.length === 0 || phase !== 'start') return
    const id = resumeIdFromUrl
    let cancelled = false
    ;(async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        const { data } = await supabase.from('sessions').select('*').eq('id', id).single()
        if (cancelled) return
        if (data) {
          setResumeIdFromUrl(null)
          sessionStorage.setItem('audit_session_id', data.id)
          resumeSession(data)
          return
        }
        await new Promise(r => setTimeout(r, 400))
      }
    })()
    return () => { cancelled = true }
  }, [resumeIdFromUrl, authChecked, allQuestions, phase])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('questions')
        .select('*, follow_ups(text, sort_order)')
        .eq('active', true)
        .in('category', ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people'])
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
    if (!user || allQuestions.length === 0 || phase !== 'start' || resumeIdFromUrl) return
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
  }, [user, allQuestions, phase, resumeIdFromUrl])

  // Auto-resume (anonymous) when returning from the dashboard
  useEffect(() => {
    if (phase !== 'start' || !authChecked || user || allQuestions.length === 0 || resumeIdFromUrl) return
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
  }, [user, authChecked, allQuestions, phase, resumeIdFromUrl])

  // Keep refs current for auto-dashboard timer (prevents stale closures)
  useEffect(() => { completedSummariesRef.current = completedSummaries }, [completedSummaries])
  useEffect(() => { questionsRef.current = questions }, [questions])
  useEffect(() => { profileRef.current = profile }, [profile])
  useEffect(() => { businessNameRef.current = businessName }, [businessName])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { languageRef.current = language; customLanguageRef.current = customLanguage }, [language, customLanguage])
  useEffect(() => { phaseRef.current = phase }, [phase])

  // Auto-generate dashboard after 15 minutes of interview if no dashboard exists yet
  useEffect(() => {
    if (phase !== 'interview') return
    const timer = setTimeout(async () => {
      if (dashboardAutoFiredRef.current) return
      if (phaseRef.current !== 'interview') return
      if (completedSummariesRef.current.length < 2) return
      const sid = sessionIdRef.current
      const prof = profileRef.current
      if (!sid || !prof) return
      // Don't fire if a dashboard was already manually created
      const { data: check } = await supabase.from('sessions').select('dashboard_cache').eq('id', sid).single()
      if (check?.dashboard_cache) { dashboardAutoFiredRef.current = true; return }
      dashboardAutoFiredRef.current = true
      setDashboardNotifStage('first')
      setDashboardNotif('creating')
      triggerAutoDashboard('first', sid, prof, questionsRef.current, completedSummariesRef.current, languageRef.current, customLanguageRef.current)
    }, 15 * 60 * 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

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
    persistedTokens.current = { input: 0, output: 0 }
    claudeResponsesRef.current = 0
    const { data } = await supabase
      .from('sessions')
      .insert({ business_name: businessName, status: 'intro', user_id: user?.id ?? null, language: effectiveLanguage, ...utmParams,
        is_test: isTest,
        // v:2 marks this as a pillar-mode session — detected on resume
        dashboard_cache: { v: 2, pillars: {} } })
      .select()
      .single()
    if (data) {
      setSessionId(data.id)
      sessionStorage.setItem('audit_session_id', data.id)
      setPhase('intro')
      const [openerText] = await localize([INTRO_OPENER])
      const opener: Message = { role: 'assistant', content: openerText }
      setIntroConversation([opener])
      setConversation([opener])
    }
  }

  // Localize the interview's fixed English scaffolding (openers, transitions,
  // pillar questions, welcome lines) into the owner's language, so the tool
  // speaks one consistent language. No-op for English. Cached per language+string
  // in sessionStorage so repeated strings aren't re-translated. langOverride is
  // used on resume, where the language state hasn't propagated to effectiveLanguage yet.
  async function localize(texts: string[], langOverride?: string): Promise<string[]> {
    const target = (langOverride || effectiveLanguage || 'English')
    if (/^english$/i.test(target)) return texts
    const key = (t: string) => `cmoTr|${target}|${t}`
    const out: (string | null)[] = texts.map(t => { try { return sessionStorage.getItem(key(t)) } catch { return null } })
    const missing = out.map((v, i) => (v == null ? i : -1)).filter(i => i >= 0)
    if (missing.length > 0) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: missing.map(i => texts[i]), language: target }),
        })
        const data = await res.json()
        trackUsage(data.usage)
        const tr: string[] = data.translations || []
        missing.forEach((origIdx, k) => {
          const val = (typeof tr[k] === 'string' && tr[k].trim()) ? tr[k] : texts[origIdx]
          out[origIdx] = val
          // Only cache real translations — never cache a failure fallback, or we'd
          // freeze English in for this string for the rest of the session.
          if (data.ok !== false && val !== texts[origIdx]) {
            try { sessionStorage.setItem(key(texts[origIdx]), val) } catch { /* quota */ }
          }
        })
      } catch {
        missing.forEach(i => { out[i] = texts[i] })
      }
    }
    return out.map((v, i) => v ?? texts[i])
  }

  // Current interview language as an English name, read from refs so it's
  // correct even inside async chains where the derived `effectiveLanguage`
  // const is a stale render-time capture.
  const currentLangName = (): string =>
    languageRef.current === 'en' ? 'English'
      : languageRef.current === 'nl' ? 'Dutch'
      : (customLanguageRef.current?.trim() || 'English')

  // Apply a detected/requested language everywhere it matters: React state, the
  // refs used by async callbacks, and the persisted session.language (which the
  // pillar/interview API prompts read). Without the DB write the language reset
  // at every pillar boundary — the original bug.
  async function applyLanguage(name: string) {
    const code = /^english$/i.test(name) ? 'en' : /^dutch$/i.test(name) ? 'nl' : 'other'
    setLanguage(code)
    languageRef.current = code
    if (code === 'other') {
      setCustomLanguage(name)
      customLanguageRef.current = name
    } else {
      customLanguageRef.current = ''
    }
    const sid = sessionIdRef.current || sessionId
    if (sid) await supabase.from('sessions').update({ language: name }).eq('id', sid)
  }

  // Detect the language of the owner's latest answer and switch to it if it
  // differs from the current one. Returns the resolved language name so callers
  // can use it for the very same turn (no one-turn lag). Short/ambiguous answers
  // are skipped so trivial replies ("ja", "ok", "€20") never flip the language.
  async function resolveLanguage(text: string): Promise<string> {
    const current = currentLangName()
    // DISABLED (2026-06-02): shipping English-only for now. The detection
    // machinery (/api/detect-language, applyLanguage, the call sites) stays
    // wired up but does not act — flip this early-return off to re-enable.
    const LANGUAGE_DETECTION_ENABLED = false
    if (!LANGUAGE_DETECTION_ENABLED) return current
    if (!text || text.trim().split(/\s+/).length < 4) return current
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      const res = await fetch('/api/detect-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      trackUsage(data.usage)
      const detected: string | null = data.language
      if (detected && detected.toLowerCase() !== current.toLowerCase()) {
        await applyLanguage(detected)
        return detected
      }
    } catch { /* detection is best-effort — keep current language on failure */ }
    return current
  }

  async function classifyAndTransition(finalIntroConv: Message[]) {
    setPhase('classifying')

    // Lock the interview language to whatever the owner actually wrote in their
    // intro (the start-screen picker is only a default). Uses both intro answers
    // for a reliable read, and feeds the result into every localize() below.
    const introText = finalIntroConv.filter(m => m.role === 'user').map(m => m.content).join('\n')
    const resolvedLang = await resolveLanguage(introText)

    let detectedProfile
    let locationPatch: { country?: string | null; city?: string | null } = {}
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
      if (json.country || json.city) locationPatch = { country: json.country ?? null, city: json.city ?? null }
    } catch {
      setAiError(true)
      setPhase('interview')
      return
    }
    setProfile(detectedProfile)
    setAnsweredIds([])

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

    // Use the ref to avoid stale closure on sessionId state
    const currentSessionId = sessionIdRef.current || sessionId
    const { error: classifyUpdateError } = await supabase.from('sessions').update({
      business_description: detectedProfile.business_description,
      business_type: detectedProfile.business_type,
      industry: detectedProfile.industry,
      awareness_level: detectedProfile.awareness_level,
      owner_tone: detectedProfile.owner_tone,
      has_employees: detectedProfile.has_employees ?? null,
      answered_ids: [],
      status: 'in_progress',
      questions_total: orderedQuestions.length,
      ...locationPatch,
    }).eq('id', currentSessionId)
    if (classifyUpdateError) console.error('[classify] session update failed:', classifyUpdateError.message)

    const awarenessLine = detectedProfile.awareness_level === 'knows_the_gap'
      ? `You already have a sense of where the gaps are — let's see if the numbers back that up.`
      : detectedProfile.awareness_level === 'has_a_hunch'
      ? `You have a hunch something's off — let's dig into where exactly.`
      : `Let's map out the full picture and find where the opportunities are hiding.`

    // ── Pillar-mode: enter first pillar after classify ────────────────────────
    if (sessionId) {
      const { data: fresh } = await supabase.from('sessions').select('dashboard_cache').eq('id', sessionId).single()
      if (fresh?.dashboard_cache?.v === 2) {
        setPillarMode(true)
        // Reliably persist the classify profile keyed on the confirmed sessionId.
        // The earlier update (via sessionIdRef) was not landing for pillar sessions,
        // leaving business_type/industry/location NULL — the benchmark data we need.
        const { error: profileSaveErr } = await supabase.from('sessions').update({
          business_description: detectedProfile.business_description,
          business_type: detectedProfile.business_type,
          industry: detectedProfile.industry,
          awareness_level: detectedProfile.awareness_level,
          owner_tone: detectedProfile.owner_tone,
          has_employees: detectedProfile.has_employees ?? null,
          ...locationPatch,
        }).eq('id', sessionId)
        if (profileSaveErr) console.error('[classify] pillar profile save failed:', profileSaveErr.message)
        const firstPillar = PILLAR_ORDER[0]
        const firstQ = orderedQuestions.find(q => q.category === firstPillar)?.core_question
          || allQuestions.find(q => q.category === firstPillar)?.core_question || ''
        const intro = `Got it — that's really helpful context. ${awarenessLine}\n\nI'll take you through 7 areas of your business one by one. We'll go as deep as needed in each. Some will take a few minutes, some more. Just answer honestly — that's what makes this valuable.\n\n${firstQ}`
        const [introLoc] = await localize([intro], resolvedLang)
        claudeResponsesRef.current += 1
        setInterviewTransition(introLoc)
        setConversation(prev => [...prev, { role: 'assistant', content: introLoc }])
        setCurrentPillarIndex(0)
        setPhase('interview')
        return
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const transition = `Got it — that's really helpful context. ${awarenessLine}\n\nDepending on how complex your business is, this usually takes between 1 and 1.5 hours. Some questions will feel obvious, some might surprise you. Just answer honestly — that's what makes this useful.\n\n${orderedQuestions[0].core_question}`

    const [transitionLoc] = await localize([transition], resolvedLang)
    claudeResponsesRef.current += 1
    setInterviewTransition(transitionLoc)
    setConversation(prev => [...prev, { role: 'assistant', content: transitionLoc }])
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

  // ── PILLAR-MODE FUNCTIONS ──────────────────────────────────────────────────

  function enterPillar(index: number, summaries: Record<string, PillarSummary>, leadingQ?: string) {
    const pillarName = PILLAR_ORDER[index]
    const q = leadingQ ?? allQuestions.find(q => q.category === pillarName)?.core_question ?? ''
    setCurrentPillarIndex(index)
    setConversation([{ role: 'assistant', content: q }])
    setPhase('interview')
  }

  async function sendPillarMessage(userInput: string) {
    const userMsg: Message = { role: 'user', content: userInput }
    const newConv = [...conversation, userMsg]
    setConversation(newConv)
    setInput('')
    setLoading(true)
    setAiError(false)

    // Follow a mid-interview language switch (e.g. owner starts answering in
    // Dutch). Resolved before the payload so the reply switches this same turn,
    // and persisted to session.language so it survives the next pillar boundary.
    const resolvedLang = await resolveLanguage(userInput)

    const pillarName = PILLAR_ORDER[currentPillarIndex]
    const pqs = allQuestions
      .filter(q => q.category === pillarName)
      .map(q => ({ id: q.id, coreQuestion: q.core_question, toolNote: q.tool_note, followUps: (q.follow_ups || []).map((f: any) => f.text) }))

    const prevContext: Record<string, { contextSummary: string; entities: any }> = {}
    for (const [name, s] of Object.entries(pillarSummariesRef.current)) {
      prevContext[name] = { contextSummary: s.contextSummary, entities: s.entities }
    }

    const pillarPayload = {
      pillarName,
      pillarLabel: PILLAR_LABELS[pillarName as PillarName] || pillarName,
      pillarQuestions: pqs,
      pillarConversation: newConv,
      previousPillarSummaries: prevContext,
      businessProfile: profile,
      language: resolvedLang,
    }
    lastPillarPayload.current = pillarPayload

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 40000)
      const res = await fetch('/api/pillar-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pillarPayload),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error('pillar API error')
      const data = await res.json()
      trackUsage(data.usage)
      // Persist cost-so-far after every turn (captures churned sessions too)
      await flushUsage()

      if (data.pillarComplete) {
        await closePillar(pillarName, newConv, data.dataBacked)
      } else {
        const assistantMsg: Message = { role: 'assistant', content: data.message }
        const fullConv = [...newConv, assistantMsg]
        setConversation(prev => [...prev, assistantMsg])
        // Persist the IN-PROGRESS pillar every turn so a mid-pillar resume picks up
        // exactly where the owner left off. Completed pillars live in
        // dashboard_cache.pillars; the current unfinished pillar lives in
        // dashboard_cache.inProgress. closePillar overwrites dashboard_cache with
        // { v:2, pillars }, which clears inProgress automatically once the pillar ends.
        // (saveResponse can't be used here — synthetic 'pillar_X' IDs fail the FK.)
        if (sessionId) {
          await supabase.from('sessions').update({
            dashboard_cache: {
              v: 2,
              pillars: pillarSummariesRef.current,
              inProgress: { pillarName, pillarIndex: currentPillarIndex, conversation: fullConv },
            },
          }).eq('id', sessionId)
        }
      }
    } catch {
      setAiError(true)
    } finally {
      setLoading(false)
    }
  }

  async function closePillar(pillarName: string, finalConv: Message[], dataBacked: boolean | null) {
    if (!sessionId || !profile) return
    // Don't call saveResponse here — 'pillar_X' IDs fail FK constraint on responses.question_id.
    // The full conversation is stored inside dashboard_cache.pillars[pillarName] below.

    setGeneratingSummary(true)
    const prevContext: Record<string, { contextSummary: string; entities: any }> = {}
    for (const [name, s] of Object.entries(pillarSummariesRef.current)) {
      prevContext[name] = { contextSummary: s.contextSummary, entities: s.entities }
    }

    let sd: any = {}
    try {
      const r = await fetch('/api/pillar-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pillarName,
          pillarLabel: PILLAR_LABELS[pillarName as PillarName] || pillarName,
          pillarConversation: finalConv,
          previousPillarSummaries: prevContext,
          businessProfile: profile,
          language: currentLangName(),
        }),
      })
      sd = await r.json()
      trackUsage(sd.usage)
      await flushUsage()
    } catch {
      sd = { contextSummary: `${pillarName} covered.`, entities: { tools: [], numbers: [], competitors: [], flags: [] }, confidence: 50, situation: '', recommendation: '', dataGaps: [] }
    }
    setGeneratingSummary(false)

    // Resolve staff status from explicit signals as the interview progresses, so
    // the People section and report are correct even when classify left it unknown.
    // Only an explicit signal flips it, and only while it's still unknown.
    let resolvedProfile = profile
    if (profile && profile.has_employees == null && (sd.staffSignal === 'has_staff' || sd.staffSignal === 'solo')) {
      const hasEmp = sd.staffSignal === 'has_staff'
      resolvedProfile = { ...profile, has_employees: hasEmp }
      setProfile(resolvedProfile)
      profileRef.current = resolvedProfile
      await supabase.from('sessions').update({ has_employees: hasEmp }).eq('id', sessionId)
    }

    const newSummary: PillarSummary = {
      contextSummary: sd.contextSummary || '',
      entities: sd.entities || { tools: [], numbers: [], competitors: [], flags: [] },
      confidence: sd.confidence ?? 50,
      situation: sd.situation || '',
      recommendation: sd.recommendation || '',
      dataGaps: sd.dataGaps || [],
      completedAt: new Date().toISOString(),
      dataBacked,
      // Store the raw conversation so transcript + report can use it
      conversation: finalConv,
    }

    const updated = { ...pillarSummariesRef.current, [pillarName]: newSummary }
    setPillarSummaries(updated)
    pillarSummariesRef.current = updated

    await supabase.from('sessions').update({
      dashboard_cache: { v: 2, pillars: updated },
      questions_completed: Object.keys(updated).length,
      questions_total: PILLAR_ORDER.length,
    }).eq('id', sessionId)

    // First completed section: nudge anonymous users to save their progress.
    // (Manual "save progress" button stays available in the header regardless.)
    if (Object.keys(updated).length === 1 && !user && !saveOverlayDismissed) {
      setShowSaveOverlay(true)
      setSaveOverlayDismissed(true)
    }

    const nextIndex = currentPillarIndex + 1
    if (nextIndex >= PILLAR_ORDER.length) {
      await supabase.from('sessions').update({ status: 'interview_done' }).eq('id', sessionId)
      // Cost is now persisted incrementally per turn via flushUsage(); this catches
      // any final delta. (Report tokens are added separately when the report generates.)
      await flushUsage()
      setPhase('referral')
    } else {
      const key = `${pillarName}→${PILLAR_ORDER[nextIndex]}`
      const trans = PILLAR_TRANSITIONS[key] || `Good. Let's move to ${PILLAR_LABELS[PILLAR_ORDER[nextIndex] as PillarName]}.`
      // People opener is tri-state on staff status: explicit solo → owner-dependency;
      // explicit staff → the team question; still unknown → establish it first
      // rather than assuming "it's just you".
      let nextQ: string
      if (PILLAR_ORDER[nextIndex] === 'people') {
        const staff = resolvedProfile?.has_employees
        if (staff === false) {
          nextQ = "Since it's just you, let's talk about how much the business depends on you personally. If you couldn't work for two weeks, what would actually happen — could anyone step in, or would everything pause?"
        } else if (staff === true) {
          nextQ = allQuestions.find(q => q.category === 'people')?.core_question || "Let's talk about your team — how stable is it, and how much of the business depends on any one person?"
        } else {
          nextQ = "Before we dig into this — is it just you running things, or do you have people working with you?"
        }
      } else {
        nextQ = allQuestions.find(q => q.category === PILLAR_ORDER[nextIndex])?.core_question || ''
      }
      const [openerLoc] = await localize([`${trans}\n\n${nextQ}`], currentLangName())
      setCurrentPillarIndex(nextIndex)
      setConversation([{ role: 'assistant', content: openerLoc }])
    }
  }

  // ── END PILLAR-MODE FUNCTIONS ─────────────────────────────────────────────

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

    // ── Pillar-mode resume ───────────────────────────────────────────────────
    if (session.dashboard_cache?.v === 2) {
      const savedPillars: Record<string, PillarSummary> = session.dashboard_cache?.pillars || {}
      const completedNames = Object.keys(savedPillars)
      const nextIdx = PILLAR_ORDER.findIndex(p => !completedNames.includes(p))

      setPillarMode(true)
      setPillarSummaries(savedPillars)
      pillarSummariesRef.current = savedPillars

      if (nextIdx === -1) {
        // All pillars done — this is a re-entry into an already-finished session
        // (e.g. via a resume link or the menu), so there's nothing left to ask.
        // Send them to their hub instead of replaying the one-time "how did you
        // find us?" referral screen, which would just bounce back to the dashboard.
        window.location.href = `/hub?session=${session.id}`
        return
      } else {
        const nextPillar = PILLAR_ORDER[nextIdx]
        const coveredCount = completedNames.length
        setCurrentPillarIndex(nextIdx)

        // Restore mid-pillar progress: if the owner answered some questions in the
        // current (still-open) pillar before leaving, those turns were saved to
        // dashboard_cache.inProgress. Rehydrate the full conversation so they
        // continue where they left off — and so the model keeps the pillar context
        // (sendPillarMessage sends the whole conversation to /api/pillar-interview).
        const inProgress = session.dashboard_cache?.inProgress
        const hasInProgress = inProgress
          && inProgress.pillarName === nextPillar
          && Array.isArray(inProgress.conversation)
          && inProgress.conversation.length > 0

        if (hasInProgress) {
          setConversation(inProgress.conversation)
        } else {
          const nextQ = allQuestions.find(q => q.category === nextPillar)?.core_question || ''
          setConversation([
            { role: 'assistant', content: `Welcome back to ${session.business_name}! Your progress is saved — we've covered ${coveredCount} section${coveredCount !== 1 ? 's' : ''} out of ${PILLAR_ORDER.length}. If you'd like a quick recap, just ask.` },
            { role: 'assistant', content: nextQ },
          ])
        }
        setPhase('interview')
      }
      setShowSignIn(false)
      setResumableSession(null)
      return
    }
    // ────────────────────────────────────────────────────────────────────────

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

    // Always start with a fresh chat on resume — never restore old conversation history.
    // Restoring partial history looks like a broken/restarted session and causes confusion.
    // Instead, give the user a clear status message so they know exactly where they are.
    const coveredCount = summaries.length
    const totalQ = filtered.length
    // Only show "new areas added" message for sessions that were previously marked complete
    // and now have new unanswered questions (re-engagement). For regular in-progress resumes,
    // the first unanswered question is always "not in answered set" — so that check is useless.
    const movingToNewArea = (session.status === 'completed' || session.status === 'interview_done') && firstUnansweredIdx !== -1

    // Two separate bubbles: orientation first, then the question on its own line.
    // This prevents the question from looking like part of the welcome and makes it
    // clear it's the next thing to answer — not a repetition from a previous session.
    const resumeConv: Message[] = []
    if (movingToNewArea) {
      resumeConv.push({ role: 'assistant' as const, content: `Welcome back! We've added some new areas to the diagnostic since you were last here — your previous answers are all saved.` })
    } else if (coveredCount > 0) {
      resumeConv.push({ role: 'assistant' as const, content: `Welcome back to ${session.business_name}! Your progress is saved — we've covered ${coveredCount} topic${coveredCount !== 1 ? 's' : ''} out of ${totalQ} so far. If you'd like a quick recap of what we discussed, just ask.` })
    } else {
      resumeConv.push({ role: 'assistant' as const, content: `Welcome back to ${session.business_name}. Let's continue.` })
    }
    if (currentQ) {
      resumeConv.push({ role: 'assistant' as const, content: currentQ.core_question })
    }

    // The question starts at the end of the welcome message array
    questionConvStartRef.current = resumeConv.length
    // Localize the welcome + resumed question into the session's language.
    const resumeLoc = await localize(resumeConv.map(m => m.content), session.language)
    setConversation(resumeConv.map((m, i) => ({ ...m, content: resumeLoc[i] ?? m.content })))
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

    // Detect language from the first answer so the follow-up is already in the
    // owner's language (classify re-confirms it from both answers afterwards).
    const resolvedLang = await resolveLanguage(userInput)

    const followup = INTRO_FOLLOWUPS[newTurns - 1]
    if (followup) {
      const [followupLoc] = await localize([followup], resolvedLang)
      setConversation(prev => [...prev, { role: 'assistant', content: followupLoc }])
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
    // Route to pillar flow for new sessions
    if (pillarMode) { await sendPillarMessage(userInput); return }

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

    // Follow a mid-interview language switch (see sendPillarMessage).
    const resolvedLang = await resolveLanguage(userInput)

    const payload = {
      question: currentQ.core_question,
      followUps: currentQ.follow_ups.map((f: { text: string }) => f.text),
      toolNote: currentQ.tool_note,
      conversation: newConv,
      previousContext: completedSummaries,
      businessProfile: profile,
      language: resolvedLang,
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
      await flushUsage()
    } catch {
      setAiError(true)
      setLoading(false)
      return
    }

    if (isComplete) {
      await saveResponse(currentQ.id, newConv)

      // Re-fetch the latest arrays from DB before writing.
      // Two questions can complete within seconds of each other (e.g. a short question
      // immediately followed by a precheck-skipped one). Both reads from React state
      // would be stale — the second write would silently drop the first question's data.
      // Fetching fresh DB values before each write makes the append safe.
      const { data: latestSession } = await supabase
        .from('sessions')
        .select('completed_summaries, answered_ids')
        .eq('id', sessionId)
        .single()
      const baseSummaries = latestSession?.completed_summaries ?? completedSummaries
      // Merge DB answered_ids with local state. Local state may contain IDs derived from
      // the legacy fallback (pre-answered_ids-column sessions) that were never written to DB.
      // Taking only the DB value would erase those legacy-derived IDs on the first write,
      // causing the session to appear to restart on the next resume.
      const baseAnsweredIds: string[] = [
        ...new Set([...(latestSession?.answered_ids ?? []), ...answeredIds])
      ]

      const ownerReplies = newConv.filter(m => m.role === 'user').map(m => m.content).join(' / ')
      // Capture only THIS question's user replies for the transcript (not the full cumulative history)
      const thisQuestionMsgs = newConv.slice(questionConvStartRef.current)
      const rawAnswer = thisQuestionMsgs.filter(m => m.role === 'user').map(m => m.content).join('\n\n')
      const newSummary = { question: currentQ.core_question, summary: ownerReplies, data_backed: dataBacked, raw_answer: rawAnswer }
      const updatedSummaries = [...baseSummaries, newSummary]
      setCompletedSummaries(updatedSummaries)

      // Track answered question IDs — this is the source of truth for resume position
      let updatedAnsweredIds = [...new Set([...baseAnsweredIds, currentQ.id])]

      let nextIndex = qIndex + 1
      while (nextIndex < questions.length) {
        const candidate = questions[nextIndex]
        const alreadyCovered = await checkIfAlreadyCovered(candidate, updatedSummaries)
        if (!alreadyCovered) break
        await saveResponse(candidate.id, [])
        updatedAnsweredIds = [...new Set([...updatedAnsweredIds, candidate.id])]
        nextIndex++
      }
      setAnsweredIds(updatedAnsweredIds)

      // Halfway auto-dashboard: fires once when ≥50% of questions answered
      if (!halfwayAutoFiredRef.current && updatedAnsweredIds.length >= Math.floor(questions.length / 2)) {
        halfwayAutoFiredRef.current = true
        const isFirst = !dashboardAutoFiredRef.current
        dashboardAutoFiredRef.current = true
        if (sessionId && profile) {
          setDashboardNotifStage(isFirst ? 'first' : 'halfway')
          setDashboardNotif('creating')
          triggerAutoDashboard(isFirst ? 'first' : 'halfway', sessionId, profile, questions, updatedSummaries, language, customLanguage)
        }
      }

      const tc = transitionCount
      setTransitionCount(tc + 1)

      if (nextIndex >= questions.length) {
        claudeResponsesRef.current += 1
        await supabase.from('sessions').update({
          status: 'interview_done',
          answered_ids: updatedAnsweredIds,
          questions_completed: updatedAnsweredIds.length,
          questions_total: questions.length,
        }).eq('id', sessionId)
        setConversation(prev => [...prev, {
          role: 'assistant',
          content: `That's everything I need. Building your report now...`,
        }])
        // Silent final dashboard refresh before redirecting to report
        if (sessionId && profile) {
          triggerAutoDashboard('end', sessionId, profile, questions, updatedSummaries, language, customLanguage)
        }
        setPhase('referral')
      } else {
        await supabase.from('sessions').update({
          current_q_index: nextIndex,
          completed_summaries: updatedSummaries,
          answered_ids: updatedAnsweredIds,
          questions_completed: updatedAnsweredIds.length,
          questions_total: questions.length,
        }).eq('id', sessionId)

        const nextQ = questions[nextIndex]
        const transition = getTransition(tc)
        const transitionMsg: Message = { role: 'assistant', content: `${transition} Moving on.\n\n${nextQ.core_question}` }
        const updatedConv = [...newConv, transitionMsg]
        setConversation(prev => [...prev, transitionMsg])
        if (sessionId) sessionStorage.setItem(`conv_${sessionId}`, JSON.stringify(updatedConv))
        // Mark where the next question starts so we can extract only its replies for raw_answer
        questionConvStartRef.current = updatedConv.length
        setQIndex(nextIndex)
      }
    } else {
      if (message && message.trim().length > 0) {
        const assistantMsg: Message = { role: 'assistant', content: message }
        const updatedConv = [...newConv, assistantMsg]
        setConversation(prev => [...prev, assistantMsg])
        await saveResponse(currentQ.id, updatedConv)
        if (sessionId) sessionStorage.setItem(`conv_${sessionId}`, JSON.stringify(updatedConv))
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

  async function triggerAutoDashboard(
    stage: 'first' | 'halfway' | 'end',
    sid: string,
    prof: BusinessProfile,
    qs: Question[],
    summaries: { question: string; summary: string; data_backed?: boolean | null }[],
    lang: string,
    customLang?: string
  ) {
    if (qs.length === 0) return
    const effectiveLang = lang === 'en' ? 'English' : lang === 'nl' ? 'Dutch' : (customLang?.trim() || 'English')

    // Build categoryData from current filtered questions + completed summaries
    const categoryOrder: string[] = []
    const catQMap = new Map<string, string[]>()
    qs.forEach(q => {
      if (!q.category) return
      if (!catQMap.has(q.category)) { catQMap.set(q.category, []); categoryOrder.push(q.category) }
      catQMap.get(q.category)!.push(q.core_question)
    })
    const summaryMap = new Map(summaries.map(s => [s.question, { summary: s.summary, data_backed: s.data_backed ?? null }]))
    const categoryData = categoryOrder.map(cat => {
      const catQs = catQMap.get(cat) || []
      return {
        name: cat,
        covered: catQs.filter(q => summaryMap.has(q)).map(q => ({
          question: q,
          summary: summaryMap.get(q)!.summary,
          data_backed: summaryMap.get(q)!.data_backed,
        })),
        uncovered: catQs.filter(q => !summaryMap.has(q)),
      }
    })

    try {
      const res = await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: prof.business_description ? businessNameRef.current : '',
          businessType: prof.business_type,
          industry: prof.industry,
          businessDescription: prof.business_description,
          ownerTone: prof.owner_tone,
          categoryData,
          language: effectiveLang,
        }),
      })
      const data = await res.json()
      if (data.categories) {
        await supabase.from('sessions').update({
          dashboard_cache: { categories: data.categories, emerging_picture: data.emerging_picture ?? null },
          dashboard_cache_count: summaries.length,
        }).eq('id', sid)
      }
      if (stage !== 'end') {
        setDashboardNotif('ready')
        setTimeout(() => setDashboardNotif('idle'), 9000)
      }
    } catch {
      if (stage !== 'end') setDashboardNotif('idle')
    }
  }

  async function handleReferral(source: string | null) {
    if (sessionId && source) {
      await supabase.from('sessions').update({ referral_source: source }).eq('id', sessionId)
    }
    // Land on the client hub — it builds the report on first arrival, then
    // surfaces the report, pillar deep-dive, and transcript in one place.
    window.location.href = `/hub?session=${sessionId}`
  }

  async function send() {
    if (!input.trim() || loading) return
    if (phase === 'intro') await sendIntro(input)
    else if (phase === 'interview') await sendInterview(input)
  }

  async function retryLastMessage() {
    // Pillar-mode retry
    if (pillarMode && lastPillarPayload.current) {
      setAiError(false)
      setLoading(true)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 40000)
        const res = await fetch('/api/pillar-interview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastPillarPayload.current),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error('retry failed')
        const data = await res.json()
        trackUsage(data.usage)
        const payload = lastPillarPayload.current as any
        if (data.pillarComplete) {
          await closePillar(payload.pillarName, payload.pillarConversation, data.dataBacked)
        } else {
          const assistantMsg: Message = { role: 'assistant', content: data.message }
          const fullConv = [...(payload.pillarConversation || []), assistantMsg]
          setConversation(prev => [...prev, assistantMsg])
          // Persist in-progress pillar on the retry path too (mirrors sendPillarMessage),
          // so a turn recovered from a timeout is still saved for mid-pillar resume.
          // No saveResponse — FK constraint on question_id prevents synthetic pillar IDs.
          if (sessionId) {
            await supabase.from('sessions').update({
              dashboard_cache: {
                v: 2,
                pillars: pillarSummariesRef.current,
                inProgress: { pillarName: payload.pillarName, pillarIndex: currentPillarIndex, conversation: fullConv },
              },
            }).eq('id', sessionId)
          }
        }
      } catch {
        setAiError(true)
      } finally {
        setLoading(false)
      }
      return
    }

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
        await flushUsage()
        setConversation(prev => [...prev, { role: 'assistant', content: "That's everything — thank you. Building your report now..." }])
        setPhase('done')
        setTimeout(() => { window.location.href = `/hub?session=${sessionId}` }, 2000)
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

  // progress bar removed — used completedSummaries count instead (qIndex is not a reliable proxy)

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

          {/* Language picker hidden (2026-06-02) — English-only for launch.
              Detection machinery stays in place; flip `false` to restore. */}
          {false && (
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
          )}

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

  // ─── REFERRAL ────────────────────────────────────────────────────────────────

  if (phase === 'referral') {
    const REFERRAL_OPTIONS = ['Google search', 'Friend or colleague', 'LinkedIn', 'Social media', 'Other']
    return (
      <div style={cardWrap}>
        <div style={card}>
          <div style={{ color: '#6A6A52', fontSize: 11, letterSpacing: '0.15em', fontFamily: 'monospace', marginBottom: 8 }}>ONE LAST THING</div>
          <h2 style={{ color: '#E8E0D0', fontSize: 20, fontWeight: 400, marginBottom: 12 }}>How did you find us?</h2>
          <p style={{ color: '#6A6A52', fontSize: 13, fontFamily: 'monospace', marginBottom: 20, lineHeight: 1.6 }}>
            Helps us reach more business owners like you.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {REFERRAL_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => handleReferral(opt)}
                style={{
                  background: 'transparent', border: '1px solid #2A2A1E', borderRadius: 8,
                  padding: '11px 16px', color: '#C8C8B0', fontFamily: 'monospace',
                  fontSize: 13, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,169,110,0.4)'; e.currentTarget.style.color = '#C8A96E' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2A2A1E'; e.currentTarget.style.color = '#C8C8B0' }}
              >
                {opt}
              </button>
            ))}
          </div>
          <button onClick={() => handleReferral(null)} style={ghostBtn}>
            Skip → View my report
          </button>
        </div>
      </div>
    )
  }


  // ─── INTERVIEW ───────────────────────────────────────────────────────────────

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
    <ClientNav
      sessionId={sessionId}
      active="interview"
      businessName={businessName}
      interviewActive
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
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#3A3A28' }}>
              {pillarMode
                ? `${Object.keys(pillarSummaries).length} of ${PILLAR_ORDER.length} sections`
                : `${completedSummaries.length} of ${questions.length} topics`}
            </span>
          </div>
        )}
      </div>

      {/* Pillar progress strip (pillar mode) */}
      {phase === 'interview' && pillarMode && (
        <div style={{
          background: '#0A0A07', borderBottom: '1px solid #111110',
          padding: '6px 16px', display: 'flex', gap: 4, overflowX: 'auto',
          flexShrink: 0, alignItems: 'center',
        }}>
          {PILLAR_ORDER.map((p, i) => {
            const done = !!pillarSummaries[p]
            const active = i === currentPillarIndex && !done
            return (
              <div key={p} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10, fontFamily: 'monospace',
                letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0,
                background: done ? '#0A120A' : active ? '#1A1A10' : 'transparent',
                border: `1px solid ${done ? '#2A4A2A' : active ? '#3A3A20' : '#1A1A14'}`,
                color: done ? '#4A8A4A' : active ? '#C8A96E' : '#2A2A1E',
              }}>
                {done ? '✓ ' : ''}{PILLAR_LABELS[p as PillarName]}
              </div>
            )
          })}
          {generatingSummary && (
            <span style={{
              marginLeft: 8, fontFamily: 'monospace', fontSize: 10, color: '#C8A96E',
              background: '#1E1A10', border: '1px solid #C8A96E30',
              borderRadius: 10, padding: '1px 8px',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}>
              ✦ Building section summary…
            </span>
          )}
        </div>
      )}

      {/* Category flow strip (legacy mode) */}
      {phase === 'interview' && !pillarMode && categoryFlow.length > 1 && (
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
              <style>{`@keyframes cmo-think { 0%, 100% { opacity: 0.2; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }`}</style>
              <div style={{ background: '#111110', border: '1px solid #1A1A14', borderRadius: '16px 16px 16px 4px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 9 }}>
                {generatingSummary && pillarMode ? (
                  <span style={{ color: '#C8A96E', fontFamily: 'monospace', fontSize: 12 }}>
                    Wrapping up {PILLAR_LABELS[PILLAR_ORDER[currentPillarIndex] as PillarName] || 'this section'} — pulling your findings together
                  </span>
                ) : (
                  <span style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 12 }}>thinking</span>
                )}
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: generatingSummary && pillarMode ? '#C8A96E' : '#4A4A38',
                      animation: `cmo-think 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </span>
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

      {/* Auto-dashboard notification */}
      {phase === 'interview' && dashboardNotif !== 'idle' && (
        <div style={{
          flexShrink: 0, background: '#0E0E0C',
          borderTop: '1px solid rgba(200,169,110,0.2)',
          borderBottom: '1px solid rgba(200,169,110,0.08)',
          padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              color: dashboardNotif === 'ready' ? '#7EB8A4' : '#C8A96E',
              fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.1em', marginBottom: 5,
            }}>
              {dashboardNotif === 'creating'
                ? (dashboardNotifStage === 'first' ? '✦ CREATING YOUR DASHBOARD' : '✦ UPDATING YOUR DASHBOARD')
                : (dashboardNotifStage === 'first' ? '✓ DASHBOARD READY' : '✓ DASHBOARD UPDATED')}
            </div>
            <div style={{ color: '#6A6A50', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.55 }}>
              {dashboardNotif === 'creating' && dashboardNotifStage === 'first'
                ? 'Your first findings are being mapped — usually takes 20–30 seconds. Find the dashboard in the grid icon (⊞) on the left once it\'s ready.'
                : dashboardNotif === 'creating'
                ? 'Adding your latest answers for more up-to-date insights. Find the dashboard in the grid icon (⊞) on the left.'
                : dashboardNotifStage === 'first'
                ? 'Your first insights are ready. Open the dashboard from the grid icon (⊞) on the left.'
                : 'New answers have been added. Open the dashboard from the grid icon (⊞) on the left to see updated insights.'}
            </div>
          </div>
          <button
            onClick={() => setDashboardNotif('idle')}
            style={{ background: 'none', border: 'none', color: '#3A3A28', cursor: 'pointer', fontFamily: 'monospace', fontSize: 14, padding: '0 4px', flexShrink: 0, lineHeight: 1 }}
          >✕</button>
        </div>
      )}

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
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="sentences"
              autoComplete="off"
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
        // Lift above the composer bar so the "?" never overlaps the Send button.
        bottomOffset={104}
        mobileBottomOffset={150}
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
