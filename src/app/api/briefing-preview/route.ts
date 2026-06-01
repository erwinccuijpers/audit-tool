import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const PILLAR_KEYS = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people'] as const

// sessions.scores uses the report's display labels, not pillar keys — map them back.
const SCORE_LABEL_TO_PILLAR: Record<string, string> = {
  'Client Acquisition': 'acquisition',
  'Marketing & Visibility': 'acquisition',
  'Revenue Optimization': 'revenue',
  'Client Retention': 'retention',
  'Tools & Systems': 'tools',
  'Competitive Position': 'positioning',
}

const PILLAR_LABEL: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

// Pick the weakest covered pillar: lowest mapped report score, else lowest pillar confidence.
function pickWeakestPillar(scores: Record<string, number> | null, pillars: Record<string, any>): string | null {
  const covered = Object.keys(pillars || {}).filter(k => PILLAR_KEYS.includes(k as any))
  if (covered.length === 0) return null

  const pillarScore: Record<string, number> = {}
  for (const [label, val] of Object.entries(scores || {})) {
    const pk = SCORE_LABEL_TO_PILLAR[label]
    if (pk && covered.includes(pk)) {
      pillarScore[pk] = Math.min(pillarScore[pk] ?? Infinity, val as number)
    }
  }
  const scored = Object.entries(pillarScore)
  if (scored.length > 0) {
    scored.sort((a, b) => a[1] - b[1])
    return scored[0][0]
  }
  // Fallback: lowest per-pillar confidence among covered pillars
  const byConfidence = covered
    .map(k => ({ k, c: pillars[k]?.confidence ?? 50 }))
    .sort((a, b) => a.c - b.c)
  return byConfidence[0]?.k ?? covered[0]
}

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { sessionId } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'No session ID' }, { status: 400 })

  // 1) Load the session
  const { data: session } = await supabase
    .from('sessions')
    .select('id, business_name, business_type, industry, business_description, language, scores, dashboard_cache, user_id, is_test, status')
    .eq('id', sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const pillars = session.dashboard_cache?.pillars || {}
  const lang = session.language || 'English'

  // 2) Find-or-create the briefing_subscribers row; return cached email0 if present
  const { data: existingSub } = await supabase
    .from('briefing_subscribers')
    .select('id, preview_email')
    .eq('session_id', sessionId)
    .limit(1)
    .maybeSingle()

  if (existingSub?.preview_email) {
    return NextResponse.json({ email0: existingSub.preview_email, cached: true })
  }

  // 3) Pick the weakest pillar to anchor the taster
  const weakest = pickWeakestPillar(session.scores, pillars)
  if (!weakest) return NextResponse.json({ error: 'Not enough interview data yet' }, { status: 422 })

  // 4) Match a story for that pillar (rank by tag weight × idea confidence)
  const { data: tags } = await supabase
    .from('idea_pillar_tags')
    .select('idea_id, weight')
    .eq('pillar_key', weakest)
  if (!tags || tags.length === 0) return NextResponse.json({ error: 'No content for this area yet' }, { status: 422 })

  const ideaIds = [...new Set(tags.map(t => t.idea_id))]
  const { data: ideas } = await supabase
    .from('idea_items')
    .select('id, external_ref, pattern_name, story, raw_idea, core_insight, hidden_asset, example_applications, bottleneck, provenance, confidence')
    .in('id', ideaIds)
    .eq('status', 'active')

  const weightOf = (id: string) => tags.find(t => t.idea_id === id)?.weight ?? 1
  const ranked = (ideas || [])
    .map(i => ({ idea: i, rank: (weightOf(i.id) || 1) * (i.confidence || 0.5) }))
    .sort((a, b) => b.rank - a.rank)
  const picked = ranked[0]?.idea
  if (!picked) return NextResponse.json({ error: 'No matching story' }, { status: 422 })

  // Optional: a pillar-specific angle for the picked story
  const { data: angles } = await supabase
    .from('idea_angles')
    .select('id, title, insight, angle_text, bottleneck, weight')
    .eq('idea_id', picked.id)
    .eq('pillar_key', weakest)
    .order('weight', { ascending: false })
    .limit(1)
  const angle = angles?.[0] || null

  // 5) Render email0 in the EMAIL-PLAYBOOK voice, in the client's language
  const p = pillars[weakest] || {}
  const provLine = picked.provenance === 'first_party'
    ? 'This is a business you worked with directly — tell it that way ("a shop I worked with…", "I once consulted for…").'
    : picked.provenance === 'second_hand'
      ? 'You heard this one secondhand — "someone I know…", "a story I heard about…".'
      : 'This is an outside/classic story — attribute it ("a classic story…", "I came across…"). Never present it as first-hand.'

  const prompt = `You are writing ONE short "preview" briefing email (email #0) for the owner of a business that just finished a diagnostic. It is a taster of a weekly briefing — prove value, don't over-deliver.

BUSINESS: ${session.business_name} — ${session.business_type || ''} / ${session.industry || ''}
${session.business_description ? `What they do: ${session.business_description}` : ''}

THE AREA THIS TASTER FOCUSES ON: ${PILLAR_LABEL[weakest]} (their biggest current gap)
Their situation here: ${p.situation || p.contextSummary || 'limited data'}
Our recommendation seed: ${p.recommendation || ''}
Open data gaps: ${(p.dataGaps || []).join('; ') || 'none noted'}

THE STORY TO BUILD FROM (${picked.external_ref}, provenance=${picked.provenance}):
Pattern: ${picked.pattern_name}
Story/source: ${picked.story || picked.raw_idea || ''}
Core insight: ${picked.core_insight || ''}
Hidden asset it unlocks: ${picked.hidden_asset || ''}
Example applications: ${picked.example_applications || ''}
${angle ? `Best angle for this area — ${angle.title}: ${angle.angle_text || angle.insight || ''}` : ''}
PROVENANCE VOICE: ${provLine}

HOW TO WRITE IT (house style):
- Lead with what this owner actually wants / their situation — not "your lowest score".
- ONE story, three parts: (a) the narrative told to a friend; (b) the transferable principle in one line; (c) a CONCRETE play for THIS owner with real first steps — name the actual move, not "you could…".
- Push the play one level deeper than the obvious.
- At most one or two numbers. No jargon. Warm, sharp, like a smart friend who runs businesses.
- Analyze, don't fully implement — name the leak, give the first step, then stop (the full plan is the paid upsell).
- Close with ONE low-friction next step.
- Keep it tight: ~180–260 words of body.

LANGUAGE: Write subject and body in ${lang}. Return ONLY valid JSON, no markdown fences:
{"subject": "...", "body": "...", "area": "${PILLAR_LABEL[weakest]}"}`

  let parsed: any = null
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '{}'
    try { parsed = JSON.parse(raw) } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : null
    }
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
  if (!parsed?.body) return NextResponse.json({ error: 'Bad generation' }, { status: 500 })

  const email0 = {
    subject: parsed.subject || `${session.business_name} — a quick win for you`,
    body: parsed.body,
    area: PILLAR_LABEL[weakest],
    source_ref: picked.external_ref,
  }

  // 6) Persist: subscriber row (caches email0) + ledger row (story shown)
  let subscriberId = existingSub?.id
  if (!subscriberId) {
    const { data: sub } = await supabase
      .from('briefing_subscribers')
      .insert({
        session_id: sessionId,
        user_id: session.user_id ?? null,
        status: 'preview',
        is_test: session.is_test ?? false,
        preview_email: email0,
      })
      .select('id')
      .single()
    subscriberId = sub?.id
  } else {
    await supabase.from('briefing_subscribers').update({ preview_email: email0 }).eq('id', subscriberId)
  }

  if (subscriberId) {
    await supabase.from('content_ledger').insert({
      subscriber_id: subscriberId,
      idea_id: picked.id,
      angle_id: angle?.id ?? null,
      pillar_key: weakest,
      surface: 'dashboard_preview',
    }).then(() => {}, () => { /* unique index = already logged; ignore */ })
  }

  return NextResponse.json({ email0, cached: false })
}
