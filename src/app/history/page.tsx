'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ClientNav from '@/components/ClientNav'

type Message = { role: 'user' | 'assistant'; content: string }

const PILLAR_ORDER = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']
const PILLAR_LABELS: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

function HistoryContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams.get('session')

  const [messages, setMessages] = useState<Message[]>([])
  const [businessName, setBusinessName] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [isPillarMode, setIsPillarMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId) { setError('No session ID.'); setLoading(false); return }
    load()
  }, [sessionId])

  async function load() {
    const { data: session } = await supabase
      .from('sessions')
      .select('business_name, created_at, dashboard_cache, completed_summaries')
      .eq('id', sessionId!)
      .single()

    if (!session) { setError('Session not found.'); setLoading(false); return }
    setBusinessName(session.business_name || '')
    setCreatedAt(session.created_at || '')

    // ── Pillar-mode v:2 — reconstruct transcript from stored pillar conversations ──
    if (session.dashboard_cache?.v === 2) {
      setIsPillarMode(true)
      const pillars: Record<string, any> = session.dashboard_cache?.pillars || {}
      const combined: Message[] = []

      for (const pillarName of PILLAR_ORDER) {
        const pillar = pillars[pillarName]
        if (!pillar) continue
        const conv: Message[] = pillar.conversation || []
        if (conv.length === 0) continue
        // Add a section label as an assistant message
        combined.push({
          role: 'assistant',
          content: `— ${PILLAR_LABELS[pillarName] || pillarName} —`,
        })
        combined.push(...conv)
      }

      // Remove trailing unanswered assistant messages
      while (combined.length > 0 && combined[combined.length - 1].role === 'assistant') {
        combined.pop()
      }

      setMessages(combined)
      setLoading(false)
      return
    }

    // ── Legacy mode — reconstruct from responses table ──────────────────────────
    const { data: responses } = await supabase
      .from('responses')
      .select('conversation, created_at')
      .eq('session_id', sessionId!)
      .order('created_at')

    if (!responses || responses.length === 0) { setLoading(false); return }

    let allMessages: Message[] = []
    let currentBest: Message[] = []
    let prevMax = 0

    for (const r of responses) {
      const conv: Message[] = r.conversation || []
      if (conv.length === 0) continue
      if (conv.length < prevMax) {
        allMessages = [...allMessages, ...currentBest]
        currentBest = conv
        prevMax = conv.length
      } else {
        currentBest = conv
        prevMax = conv.length
      }
    }
    if (currentBest.length > 0) allMessages = [...allMessages, ...currentBest]
    while (allMessages.length > 0 && allMessages[allMessages.length - 1].role === 'assistant') {
      allMessages = allMessages.slice(0, -1)
    }

    setMessages(allMessages)
    setLoading(false)
  }

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
    catch { return '' }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 12 }}>Loading transcript…</span>
    </div>
  )
  if (error) return (
    <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#BF4A2E', fontFamily: 'monospace', fontSize: 12 }}>{error}</span>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#FBFAF7', color: '#2A2A28' }}>
      <ClientNav
        sessionId={sessionId}
        active="history"
        businessName={businessName}
        actions={
          <span style={{ color: '#D8D2C6', fontFamily: 'monospace', fontSize: 10 }}>
            {formatDate(createdAt)}
          </span>
        }
      />

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 80px' }}>
        {messages.length === 0 ? (
          <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', padding: '60px 0' }}>
            No conversation recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((msg, i) => {
              const isAssistant = msg.role === 'assistant'
              // Section divider style for pillar labels
              const isSectionLabel = isPillarMode && isAssistant && msg.content.startsWith('—') && msg.content.endsWith('—')
              if (isSectionLabel) return (
                <div key={i} style={{
                  textAlign: 'center', padding: '16px 0 8px',
                  fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.12em',
                  color: '#8A857A',
                }}>
                  {msg.content}
                </div>
              )
              return (
                <div key={i} style={{ display: 'flex', justifyContent: isAssistant ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '78%',
                    background: isAssistant ? '#FFFFFF' : '#FFFFFF',
                    border: `1px solid ${isAssistant ? '#E5E1D8' : '#F4F1EA'}`,
                    borderRadius: isAssistant ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                    padding: '10px 14px',
                    color: isAssistant ? '#8A6D2F' : '#6B675E',
                    fontFamily: 'Georgia, serif',
                    fontSize: 14, lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {msg.content}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function HistoryPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#8A857A', fontFamily: 'monospace', fontSize: 12 }}>Loading…</div>
      </div>
    }>
      <HistoryContent />
    </Suspense>
  )
}
