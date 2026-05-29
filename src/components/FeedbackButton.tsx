'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  sessionId?: string | null
  context?: Record<string, unknown>
}

const CATEGORIES = [
  { value: 'stuck', label: 'I got stuck or confused' },
  { value: 'error', label: 'Something broke' },
  { value: 'slow', label: 'It\'s loading forever' },
  { value: 'question', label: 'I have a question' },
  { value: 'other', label: 'Other' },
]

export default function FeedbackButton({ sessionId, context }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [category, setCategory] = useState('stuck')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!text.trim() || loading) return
    setLoading(true)

    // Enrich context with conversation snippet from sessionStorage
    let conversationSnippet: any[] = []
    if (sessionId) {
      try {
        const cached = sessionStorage.getItem(`conv_${sessionId}`)
        if (cached) {
          const parsed = JSON.parse(cached)
          conversationSnippet = parsed.slice(-4) // last 4 messages
        }
      } catch { /* ignore */ }
    }

    const { data: { user } } = await supabase.auth.getUser()

    const enrichedContext = {
      ...context,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      conversationSnippet,
    }

    const { data: inserted } = await supabase.from('feedback').insert({
      session_id: sessionId || null,
      category,
      feedback_type: 'bug',
      feedback_text: text,
      error_context: enrichedContext,
      user_email: user?.email || null,
    }).select('id').single()

    setSubmitted(true)
    setLoading(false)

    // Fire analyze in background — user never waits for this
    if (inserted?.id) {
      fetch('/api/feedback-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackId: inserted.id,
          sessionId: sessionId || null,
          feedbackType: 'bug',
          feedbackText: text,
          feedbackCategory: category,
          errorContext: enrichedContext,
        }),
      }).catch(() => { /* background, non-critical */ })
    }

    setTimeout(() => {
      setOpen(false)
      setSubmitted(false)
      setText('')
      setCategory('stuck')
    }, 2500)
  }

  const mono: React.CSSProperties = { fontFamily: 'monospace' }

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 200 }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: 48, right: 0, width: 290,
          background: '#111110', border: '1px solid #222218', borderRadius: 12,
          padding: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {submitted ? (
            <div style={{ ...mono, fontSize: 12, color: '#7EB8A4', textAlign: 'center', padding: '10px 0', lineHeight: 1.6 }}>
              Got it — thank you.<br />
              <span style={{ color: '#4A6A4A', fontSize: 11 }}>We've logged this and will look into it.</span>
            </div>
          ) : (
            <>
              <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: '#3A3A28', marginBottom: 12 }}>
                SEND FEEDBACK
              </div>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  style={{
                    width: '100%', background: '#0C0C09', border: '1px solid #1E1E14',
                    borderRadius: 6, padding: '8px 28px 8px 10px', color: '#8A8070',
                    ...mono, fontSize: 11, outline: 'none',
                    appearance: 'none', cursor: 'pointer',
                  }}
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <span style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  color: '#4A4A38', fontSize: 10, pointerEvents: 'none',
                }}>▾</span>
              </div>
              <textarea
                autoFocus
                placeholder="Tell us what happened..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submit() }}
                rows={3}
                style={{
                  width: '100%', background: '#0C0C09', border: '1px solid #1E1E14',
                  borderRadius: 6, padding: '8px 10px', color: '#E8E0D0',
                  ...mono, fontSize: 12, outline: 'none', resize: 'none',
                  lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 10,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{ background: 'transparent', border: 'none', color: '#3A3A28', ...mono, fontSize: 11, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!text.trim() || loading}
                  style={{
                    background: !text.trim() || loading ? '#1A1A14' : '#C8A96E',
                    border: 'none', borderRadius: 6, padding: '8px 16px',
                    color: !text.trim() || loading ? '#4A4A38' : '#0C0C09',
                    ...mono, fontSize: 11, fontWeight: 600,
                    cursor: !text.trim() || loading ? 'default' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {loading ? 'Sending...' : 'Send →'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title="Something wrong? Send feedback"
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: open ? '#C8A96E' : '#111110',
          border: `1px solid ${open ? '#C8A96E' : '#2A2A1E'}`,
          color: open ? '#0C0C09' : '#4A4A38',
          ...mono, fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          transition: 'all 0.2s',
        }}
      >
        ?
      </button>
    </div>
  )
}
