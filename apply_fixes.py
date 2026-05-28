import re, sys, shutil
from pathlib import Path

path = Path.home() / 'audit-tool' / 'src' / 'app' / 'page.tsx'

if not path.exists():
    print(f"❌ File not found: {path}")
    print("   Make sure you're running this from your Mac and the audit-tool folder exists.")
    sys.exit(1)

# Backup first
backup = path.with_suffix('.tsx.bak')
shutil.copy(path, backup)
print(f"✅ Backup saved to {backup.name}")

code = path.read_text()
original = code
changes = 0

# ─────────────────────────────────────────────
# FIX A — Add aiError state + lastPayload ref
# ─────────────────────────────────────────────
old = "  const [introTurns, setIntroTurns] = useState(0)\n  const bottomRef = useRef<HTMLDivElement>(null)"
new = """  const [introTurns, setIntroTurns] = useState(0)
  const [aiError, setAiError] = useState(false)
  const lastPayload = useRef<object | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)"""
if old in code:
    code = code.replace(old, new, 1)
    changes += 1
    print("✅ Fix A: Added aiError state and lastPayload ref")
else:
    print("⚠️  Fix A: Could not find target — skipping (may already be applied)")

# ─────────────────────────────────────────────
# FIX B — Save sessionId to sessionStorage
# ─────────────────────────────────────────────
old = "      setSessionId(data.id)\n      setPhase('intro')"
new = """      setSessionId(data.id)
      sessionStorage.setItem('audit_session_id', data.id)
      setPhase('intro')"""
if old in code:
    code = code.replace(old, new, 1)
    changes += 1
    print("✅ Fix B: sessionId now saved to sessionStorage")
else:
    print("⚠️  Fix B: Could not find target — skipping")

# ─────────────────────────────────────────────
# FIX C — Timeout wrapper around /api/interview fetch
# ─────────────────────────────────────────────
old = """    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: currentQ.core_question,
        followUps: currentQ.follow_ups.map((f: { text: string }) => f.text),
        toolNote: currentQ.tool_note,
        conversation: newConv,
        previousContext: completedSummaries,
      }),
    })

    const { message, isComplete } = await res.json()"""
new = """    const payload = {
      question: currentQ.core_question,
      followUps: currentQ.follow_ups.map((f: { text: string }) => f.text),
      toolNote: currentQ.tool_note,
      conversation: newConv,
      previousContext: completedSummaries,
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
    }"""
if old in code:
    code = code.replace(old, new, 1)
    changes += 1
    print("✅ Fix C: 40s timeout added to /api/interview fetch")
else:
    print("⚠️  Fix C: Could not find interview fetch block — skipping")

# ─────────────────────────────────────────────
# FIX D — Timeout wrapper around /api/classify fetch
# ─────────────────────────────────────────────
old = """    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: finalIntroConv, businessName }),
    })

    const { profile: detectedProfile } = await res.json()"""
new = """    let detectedProfile
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
    }"""
if old in code:
    code = code.replace(old, new, 1)
    changes += 1
    print("✅ Fix D: 40s timeout added to /api/classify fetch")
else:
    print("⚠️  Fix D: Could not find classify fetch block — skipping")

# ─────────────────────────────────────────────
# FIX E — Add retryLastMessage() function
#          Insert it right before the return statement of the component
# ─────────────────────────────────────────────
retry_fn = """
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
        setConversation(prev => [...prev, { role: 'assistant', content: "That\\'s everything — thank you. Building your report now..." }])
        setDone(true)
        setTimeout(() => { window.location.href = `/results?session=${sessionId}` }, 2000)
      } else {
        const nextQ = questions[qIndex + 1]
        setConversation(prev => [...prev, { role: 'assistant', content: `Got it. Moving on.\\n\\n${nextQ.core_question}` }])
        setQIndex(qIndex + 1)
      }
    } else {
      setConversation(prev => [...prev, { role: 'assistant', content: message }])
    }

    setLoading(false)
    setAiError(false)
  }

"""

if 'async function retryLastMessage' not in code:
    # Insert just before the return statement of the default export
    insert_marker = '\n  return ('
    idx = code.rfind(insert_marker)
    if idx != -1:
        code = code[:idx] + retry_fn + code[idx:]
        changes += 1
        print("✅ Fix E: retryLastMessage() function added")
    else:
        print("⚠️  Fix E: Could not find insertion point for retry function")
else:
    print("⚠️  Fix E: retryLastMessage already exists — skipping")

# ─────────────────────────────────────────────
# FIX F — Update the thinking bubble + add error bubble
# ─────────────────────────────────────────────
old_thinking = """        {loading && (
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              background: '#111110', border: '1px solid #1A1A14',
              borderRadius: '16px 16px 16px 4px', padding: '12px 16px',
            }}>
              <span style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 12 }}>thinking...</span>
            </div>
          </div>
        )}"""
new_thinking = """        {loading && !aiError && (
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              background: '#111110', border: '1px solid #1A1A14',
              borderRadius: '16px 16px 16px 4px', padding: '12px 16px',
            }}>
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
              <button
                onClick={retryLastMessage}
                style={{
                  alignSelf: 'flex-start',
                  background: '#C8A96E', border: 'none', borderRadius: 6,
                  padding: '7px 14px', color: '#0C0C09',
                  fontFamily: 'monospace', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', letterSpacing: '0.03em',
                }}
              >
                ↩ Continue where I left off
              </button>
            </div>
          </div>
        )}"""

if old_thinking in code:
    code = code.replace(old_thinking, new_thinking, 1)
    changes += 1
    print("✅ Fix F: Error bubble with retry button added to UI")
else:
    print("⚠️  Fix F: Could not find thinking bubble — skipping")

# ─────────────────────────────────────────────
# FIX G — Copy: landing subtitle
# ─────────────────────────────────────────────
for old_copy in [
    'A 10-minute conversation that maps where your business is leaving money on the table.',
    'A 10–minute conversation that maps where your business is leaving money on the table.',
    'A 10-minute conversation that maps where\nyour business is leaving money on the\ntable.',
]:
    if old_copy in code:
        code = code.replace(old_copy, '10–20 minutes depending on the complexity of your business — maps exactly where you\'re leaving money on the table.', 1)
        changes += 1
        print("✅ Fix G: Landing subtitle updated")
        break
else:
    print("⚠️  Fix G: Landing subtitle not found — skipping (check manually)")

# ─────────────────────────────────────────────
# FIX H — Copy: progress bar /20 denominator
# ─────────────────────────────────────────────
for old_prog in ['}/20', '} / 20', '/20']:
    if old_prog in code:
        code = code.replace(old_prog, '} of {questions.length}', 1)
        changes += 1
        print("✅ Fix H: Progress counter now shows dynamic question total")
        break
else:
    print("⚠️  Fix H: Progress /20 not found — may already be dynamic")

# ─────────────────────────────────────────────
# Write file
# ─────────────────────────────────────────────
if code != original:
    path.write_text(code)
    print(f"\n✅ All done — {changes} fix(es) applied and saved to {path}")
    print("   Your original file is backed up as page.tsx.bak")
    print("\nNext step: run   npm run build   to check for errors, then   vercel --prod   to deploy.")
else:
    print("\n⚠️  No changes were written — all fixes were already present or targets not found.")
    print("   Check the ⚠️ warnings above to see what was skipped.")
