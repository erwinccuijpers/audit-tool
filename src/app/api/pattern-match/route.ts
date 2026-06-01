import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const BUCKETS = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people', 'outliers'] as const
type BucketName = typeof BUCKETS[number]

const BUCKET_DESCRIPTIONS: Record<BucketName, string> = {
  positioning:  'Brand clarity, differentiation, niche, target market definition',
  acquisition:  'Getting new customers — marketing, sales, lead generation',
  retention:    'Keeping existing customers — loyalty, re-engagement, repeat business',
  revenue:      'Pricing strategy, revenue streams, financial performance, upsells',
  strategy:     'Business direction, competitive positioning, growth plans',
  tools:        'Systems, software, processes, automation, data tracking',
  people:       'Staff management, team culture, delegation, hiring, capacity',
  outliers:     'Issues that don\'t fit cleanly into any of the above categories',
}

type Issue = {
  id: string
  description: string
  count: number
  affected: { session_id: string; business_name: string; quote: string }[]
  created_at: string
  last_updated_at: string
}

type BucketData = { issues: Issue[] }
// processed_sessions maps session_id → { summary_count, processed_at }
// A session is "stale" (needs re-processing) when its current summary count
// exceeds the count stored here. This way sessions auto-re-queue whenever
// the client answers more questions — no manual trigger needed.
type ProcessedMeta = { summary_count: number; processed_at: string }

type PatternSlotsCache = {
  buckets: Partial<Record<BucketName, BucketData>>
  processed_sessions: Record<string, ProcessedMeta>
  last_updated_at: string
}

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function initCache(): PatternSlotsCache {
  const buckets: Partial<Record<BucketName, BucketData>> = {}
  for (const b of BUCKETS) buckets[b] = { issues: [] }
  return { buckets, processed_sessions: {}, last_updated_at: new Date().toISOString() }
}

export async function POST(req: NextRequest) {
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const body = await req.json().catch(() => ({}))
  const targetSessionId: string | undefined = body.sessionId
  // Real vs Demo are kept in fully separate pattern caches so they never mix.
  // For a targeted (background) call, derive the mode from that session itself so
  // it always files into the right bucket regardless of any admin toggle.
  let mode: 'real' | 'demo'
  if (targetSessionId) {
    const { data: tgt } = await serviceClient.from('sessions').select('is_test').eq('id', targetSessionId).single()
    mode = tgt?.is_test ? 'demo' : 'real'
  } else {
    mode = body.mode === 'demo' ? 'demo' : 'real'
  }
  const cacheKey = `pattern_slots_${mode}`

  // Load existing pattern slots for this mode
  const { data: cacheRow } = await serviceClient
    .from('admin_cache')
    .select('data')
    .eq('key', cacheKey)
    .single()

  // Migrate from old formats if needed
  const rawCache = cacheRow?.data
  let existing: PatternSlotsCache
  if (rawCache?.processed_sessions) {
    existing = rawCache
  } else if (rawCache?.buckets) {
    // Had buckets but old flat array — migrate
    existing = { ...rawCache, processed_sessions: {} }
    // Carry over old processed IDs with count=0 so they don't re-run unless they've grown
    for (const id of (rawCache.processed_session_ids || [])) {
      existing.processed_sessions[id] = { summary_count: 0, processed_at: rawCache.last_updated_at ?? new Date().toISOString() }
    }
  } else {
    existing = initCache()
  }

  // Ensure all buckets exist (handles partial cache)
  for (const b of BUCKETS) {
    if (!existing.buckets[b]) existing.buckets[b] = { issues: [] }
  }

  // Find sessions to process — any session whose current summary/pillar count
  // is higher than what was recorded when it was last processed
  let query = serviceClient
    .from('sessions')
    .select('id, business_name, business_type, industry, completed_summaries, scores, status, dashboard_cache, questions_completed')

  // Targeted call → that one session (mode already derived from it above).
  // Bulk call → only this mode's sessions: demo = is_test true, real = is_test false.
  if (targetSessionId) query = query.eq('id', targetSessionId)
  else query = query.eq('is_test', mode === 'demo')

  const { data: allSessions } = await query

  const getSessionTopicCount = (s: any) => {
    if (s.dashboard_cache?.v === 2) return Object.keys(s.dashboard_cache?.pillars || {}).length
    return (s.completed_summaries || []).length
  }

  const toProcess = (allSessions || []).filter(s => {
    const currentCount = getSessionTopicCount(s)
    if (currentCount === 0) return false
    const prev = existing.processed_sessions[s.id]
    return !prev || currentCount > prev.summary_count
  })

  if (toProcess.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  // Build existing issues list for each bucket (for matching)
  const existingIssuesList = BUCKETS
    .map(b => {
      const issues = existing.buckets[b]?.issues ?? []
      if (issues.length === 0) return null
      const lines = issues.map(iss => `  - ID:${iss.id} "${iss.description}" (${iss.count}×)`).join('\n')
      return `[${b}]\n${lines}`
    })
    .filter(Boolean)
    .join('\n\n')

  const PILLAR_ORDER_PM = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people']

  // Format sessions for Claude — handles both pillar (v:2) and legacy formats
  const sessionsText = toProcess
    .map(s => {
      let findings: string
      if (s.dashboard_cache?.v === 2) {
        const pillars = s.dashboard_cache?.pillars || {}
        findings = PILLAR_ORDER_PM
          .filter((p: string) => pillars[p])
          .map((p: string) => {
            const pd = pillars[p]
            const entities = pd.entities || {}
            return `  • ${p.toUpperCase()}: ${pd.situation || pd.contextSummary || ''}\n    Tools: ${entities.tools?.join(', ') || 'none'} | Flags: ${entities.flags?.join(', ') || 'none'}`
          })
          .join('\n')
      } else {
        findings = (s.completed_summaries || [])
          .map((cs: any) => `  • ${cs.question}: ${cs.summary}`)
          .join('\n')
      }
      return `SESSION_ID:${s.id}\nBusiness: ${s.business_name} (${s.business_type || '?'}, ${s.industry || '?'})\nFindings:\n${findings}`
    })
    .join('\n\n---\n\n')

  const bucketDefs = BUCKETS
    .map(b => `- ${b}: ${BUCKET_DESCRIPTIONS[b]}`)
    .join('\n')

  const prompt = `You are classifying business weaknesses from diagnostic interviews into category buckets.

BUCKETS (use these exact names):
${bucketDefs}

EXISTING ISSUES IN EACH BUCKET:
${existingIssuesList || '(none yet)'}

SESSIONS TO CLASSIFY:
${sessionsText}

For each session, identify the 3–5 most significant weaknesses or root problems. For each one:
1. Pick the best-fitting bucket name
2. Check if it matches an existing issue in that bucket (same root problem, different words = same issue)
3. If it matches: use the existing issue's ID
4. If it's new: write a clear universal description (max 10 words — should apply to many businesses, not just this one)
5. Write a short quote (max 12 words) from this owner's answers

Return ONLY valid JSON:
{
  "sessions": [
    {
      "session_id": "SESSION_ID_VALUE",
      "classifications": [
        {
          "bucket": "retention",
          "existing_issue_id": "abc123",
          "new_description": null,
          "quote": "short quote from this owner"
        },
        {
          "bucket": "tools",
          "existing_issue_id": null,
          "new_description": "No system for tracking client history",
          "quote": "I keep it all in my head"
        }
      ]
    }
  ]
}

Rules:
- Descriptions must be universal problems, not business-specific observations
- If the same issue fits multiple buckets, pick the most relevant one only
- Use "outliers" only when genuinely unclear — prefer the closest real bucket
- session_id must exactly match SESSION_ID_VALUE from the input`

  let parsed: any = null
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
    try { parsed = JSON.parse(raw) } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : null
    }
  } catch {
    return NextResponse.json({ error: 'Claude call failed' }, { status: 500 })
  }

  if (!parsed?.sessions) {
    return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const updatedBuckets = { ...existing.buckets }

  for (const sessionResult of parsed.sessions) {
    const session = toProcess.find(s => s.id === sessionResult.session_id)
    if (!session) continue

    for (const c of sessionResult.classifications || []) {
      const bucketName = BUCKETS.includes(c.bucket) ? c.bucket as BucketName : 'outliers'
      const bucket = updatedBuckets[bucketName]!

      if (c.existing_issue_id) {
        const issue = bucket.issues.find(i => i.id === c.existing_issue_id)
        if (issue && !issue.affected.some(a => a.session_id === session.id)) {
          issue.count += 1
          issue.affected.push({ session_id: session.id, business_name: session.business_name || 'Unknown', quote: c.quote || '' })
          issue.last_updated_at = now
        }
      } else if (c.new_description) {
        // Deduplicate: don't add the same session twice to a very similar new issue
        bucket.issues.push({
          id: makeId(),
          description: c.new_description,
          count: 1,
          affected: [{ session_id: session.id, business_name: session.business_name || 'Unknown', quote: c.quote || '' }],
          created_at: now,
          last_updated_at: now,
        })
      }
    }
  }

  // Sort issues by count descending within each bucket
  for (const b of BUCKETS) {
    updatedBuckets[b]!.issues.sort((a, b) => b.count - a.count)
  }

  // Record each session's summary count at time of processing.
  // Next run will re-queue any session whose count has grown since.
  const updatedProcessedSessions: Record<string, ProcessedMeta> = { ...existing.processed_sessions }
  for (const s of toProcess) {
    updatedProcessedSessions[s.id] = {
      summary_count: getSessionTopicCount(s),
      processed_at: now,
    }
  }

  const updatedCache: PatternSlotsCache = {
    buckets: updatedBuckets,
    processed_sessions: updatedProcessedSessions,
    last_updated_at: now,
  }

  await serviceClient
    .from('admin_cache')
    .upsert(
      { key: cacheKey, data: updatedCache, sessions_count: toProcess.length, updated_at: now },
      { onConflict: 'key' }
    )

  const totalIssues = BUCKETS.reduce((sum, b) => sum + (updatedBuckets[b]?.issues.length ?? 0), 0)
  return NextResponse.json({ ok: true, processed: toProcess.length, totalIssues })
}
