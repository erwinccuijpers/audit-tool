import sys, shutil
from pathlib import Path

path = Path.home() / 'audit-tool' / 'src' / 'app' / 'page.tsx'

if not path.exists():
    print(f"❌ File not found: {path}")
    sys.exit(1)

backup = path.with_suffix('.tsx.bak2')
shutil.copy(path, backup)
print(f"✅ Backup saved to {backup.name}")

code = path.read_text()
original = code
changes = 0

# ─────────────────────────────────────────────
# FIX A — Add aiError state + lastPayload ref
# anchor is now transitionCount (not introTurns)
# ─────────────────────────────────────────────
old = "  const [transitionCount, setTransitionCount] = useState(0)\n  const bottomRef = useRef<HTMLDivElement>(null)"
new = "  const [transitionCount, setTransitionCount] = useState(0)\n  const [aiError, setAiError] = useState(false)\n  const lastPayload = useRef<object | null>(null)\n  const bottomRef = useRef<HTMLDivElement>(null)"

if 'const [aiError' in code:
    print("✅ Fix A: aiError already present — skipping")
elif old in code:
    code = code.replace(old, new, 1)
    changes += 1
    print("✅ Fix A: Added aiError state and lastPayload ref")
else:
    print("⚠️  Fix A: Could not find anchor — paste output of:")
    print("   sed -n '67,72p' ~/audit-tool/src/app/page.tsx")

# ─────────────────────────────────────────────
# FIX C — Timeout wrapper on main send() fetch
# This block includes businessProfile: profile
# We only replace the FIRST occurrence (the send() one,
# not the retryLastMessage one which already has a timeout)
# ─────────────────────────────────────────────
old_fetch = """    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: currentQ.core_question,
        followUps: currentQ.follow_ups.map((f: { text: string }) => f.text),
        toolNote: currentQ.tool_note,
        conversation: newConv,
        previousContext: completedSummaries,
        businessProfile: profile,
      }),
    })

    const { message, isComplete } = await res.json()"""

new_fetch = """    const payload = {
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
    }"""

if 'lastPayload.current = payload' in code:
    print("✅ Fix C: Timeout already present on send() — skipping")
elif old_fetch in code:
    code = code.replace(old_fetch, new_fetch, 1)
    changes += 1
    print("✅ Fix C: 40s timeout added to main send() fetch")
else:
    print("⚠️  Fix C: Could not find interview fetch block — paste output of:")
    print("   sed -n '213,235p' ~/audit-tool/src/app/page.tsx")

# ─────────────────────────────────────────────
# FIX F — Update thinking bubble (deeper indent version)
# ─────────────────────────────────────────────
old_think = """          {loading && (
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                background: '#111110', border: '1px solid #1A1A14',
                borderRadius: '16px 16px 16px 4px', padding: '12px 16px',
              }}>
                <span style={{ color: '#4A4A38', fontFamily: 'monospace', fontSize: 12 }}>thinking...</span>
              </div>
            </div>
          )}"""

new_think = """          {loading && !aiError && (
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

if 'aiError &&' in code and 'Continue where I left off' in code:
    print("✅ Fix F: Error bubble already present — skipping")
elif old_think in code:
    code = code.replace(old_think, new_think, 1)
    changes += 1
    print("✅ Fix F: Error bubble with retry button added")
else:
    print("⚠️  Fix F: Could not find thinking bubble — paste output of:")
    print("   sed -n '446,462p' ~/audit-tool/src/app/page.tsx")

# ─────────────────────────────────────────────
# FIX G — Landing subtitle (no "10-minute" prefix)
# ─────────────────────────────────────────────
old_sub = "            A conversation that maps where your business is leaving money on the table."
new_sub = "            10–20 minutes depending on the complexity of your business — maps exactly where you're leaving money on the table."

if '10\u201320 minutes depending' in code:
    print("✅ Fix G: Subtitle already updated — skipping")
elif old_sub in code:
    code = code.replace(old_sub, new_sub, 1)
    changes += 1
    print("✅ Fix G: Landing subtitle updated")
else:
    print("⚠️  Fix G: Subtitle not found — paste output of:")
    print("   sed -n '302,308p' ~/audit-tool/src/app/page.tsx")

# ─────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────
if code != original:
    path.write_text(code)
    print(f"\n✅ Done — {changes} fix(es) applied and saved.")
    print("   Backup: page.tsx.bak2")
    print("\nNext: run   npm run build   then   vercel --prod")
else:
    print(f"\n✅ Done — {changes} fix(es) applied (others already present).")
    print("\nNext: run   npm run build   then   vercel --prod")
