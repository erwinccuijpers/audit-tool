import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const PILLAR_KEYS = ['positioning', 'acquisition', 'retention', 'revenue', 'strategy', 'tools', 'people'] as const

// sessions.scores uses the report's display labels, not pillar keys — map them back.
const SCORE_LABEL_TO_PILLAR: Record<string, string> = {
  // Current 7-pillar report labels
  'Positioning': 'positioning',
  'Acquisition': 'acquisition',
  'Retention': 'retention',
  'Revenue': 'revenue',
  'Strategy': 'strategy',
  'Tools & Systems': 'tools',
  'People': 'people',
  // Legacy pre-consolidation labels (older sessions)
  'Client Acquisition': 'acquisition',
  'Marketing & Visibility': 'acquisition',
  'Revenue Optimization': 'revenue',
  'Client Retention': 'retention',
  'Competitive Position': 'positioning',
}

const PILLAR_LABEL: Record<string, string> = {
  positioning: 'Positioning', acquisition: 'Acquisition', retention: 'Retention',
  revenue: 'Revenue', strategy: 'Strategy', tools: 'Tools & Systems', people: 'People',
}

const CLAUDE_URL = 'https://claude.ai'

// Documentation roots for tools owners commonly name. Keyed by a lowercase
// substring matched against the tools surfaced in the interview, so the email
// can point at REAL sources instead of vague "pull some reports".
const TOOL_DOCS: { match: string; name: string; url: string }[] = [
  { match: 'lightspeed', name: 'Lightspeed', url: 'https://retail-support.lightspeedhq.com/hc/en-us' },
  { match: 'shopify', name: 'Shopify', url: 'https://help.shopify.com/en/manual/reports-and-analytics' },
  { match: 'google analytics', name: 'Google Analytics', url: 'https://support.google.com/analytics' },
  { match: 'analytics', name: 'Google Analytics', url: 'https://support.google.com/analytics' },
  { match: 'google ads', name: 'Google Ads', url: 'https://support.google.com/google-ads' },
  { match: 'exact', name: 'Exact Online', url: 'https://support.exactonline.com' },
  { match: 'klarna', name: 'Klarna', url: 'https://www.klarna.com/business/' },
  { match: 'zettle', name: 'Zettle', url: 'https://www.zettle.com/help' },
  { match: 'woocommerce', name: 'WooCommerce', url: 'https://woocommerce.com/documentation/' },
  { match: 'quickbooks', name: 'QuickBooks', url: 'https://quickbooks.intuit.com/learn-support/' },
  { match: 'hubspot', name: 'HubSpot', url: 'https://knowledge.hubspot.com' },
  { match: 'mailchimp', name: 'Mailchimp', url: 'https://mailchimp.com/help/' },
  { match: 'klaviyo', name: 'Klaviyo', url: 'https://help.klaviyo.com' },
  { match: 'square', name: 'Square', url: 'https://squareup.com/help' },
  { match: 'stripe', name: 'Stripe', url: 'https://support.stripe.com' },
]

// Collect the distinct tools the owner actually named across all pillars, and
// resolve any that match a known documentation source.
function gatherTools(pillars: Record<string, any>): { names: string[]; docs: { name: string; url: string }[] } {
  const names = Array.from(new Set(
    Object.values(pillars || {}).flatMap((p: any) => p?.entities?.tools || [])
  )) as string[]
  const docs: { name: string; url: string }[] = []
  const seen = new Set<string>()
  for (const t of names) {
    const lc = t.toLowerCase()
    const hit = TOOL_DOCS.find(d => lc.includes(d.match))
    if (hit && !seen.has(hit.name)) { docs.push({ name: hit.name, url: hit.url }); seen.add(hit.name) }
  }
  return { names, docs }
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
    .select('id, external_ref, pattern_name, story, raw_idea, core_insight, hidden_asset, example_applications, bottleneck, provenance, confidence, status')
    .in('id', ideaIds)
    .in('status', ['approved', 'active'])

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
  const { names: toolNames, docs: toolDocs } = gatherTools(pillars)
  const toolsBlock = toolDocs.length
    ? toolDocs.map(d => `- ${d.name}: ${d.url}`).join('\n')
    : ''
  const toolsLine = toolNames.length
    ? `Tools this owner actually uses: ${toolNames.join(', ')}.`
    : 'No specific tools were named — keep the sources generic (their POS / analytics / spreadsheet).'
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
Open data gaps (these are the things they should go pull/measure): ${(p.dataGaps || []).join('; ') || 'none noted'}

${toolsLine}
${toolsBlock ? `Real documentation links you may cite (only for tools they actually use):\n${toolsBlock}` : ''}
Claude (for the "drop your data in and ask" step): ${CLAUDE_URL}

THE STORY TO BUILD FROM (${picked.external_ref}, provenance=${picked.provenance}):
Pattern: ${picked.pattern_name}
Story/source: ${picked.story || picked.raw_idea || ''}
Core insight: ${picked.core_insight || ''}
Hidden asset it unlocks: ${picked.hidden_asset || ''}
Example applications: ${picked.example_applications || ''}
${angle ? `Best angle for this area — ${angle.title}: ${angle.angle_text || angle.insight || ''}` : ''}
PROVENANCE VOICE: ${provLine}

HOW TO WRITE IT (house style — a consultant sharing inspiration, then making it tangible):
- Lead with what this owner actually wants / their situation — not "your lowest score".
- ONE story, told like you would to a friend: (a) the narrative; (b) the transferable principle in one line; (c) the CONCRETE play for THIS owner — name the actual move, not "you could…". Push it one level past the obvious.
- THEN a tangible "This week, try this" block that turns the play into something they can do with tools they already have. Make it a guided, source-filled path, e.g.:
  · "This week, try pulling reports like [name 2-3 SPECIFIC reports/metrics tied to the open data gaps above] in [their actual tool] ([cite the real doc link from the list when one exists])."
  · "Export them as CSV and either eyeball them in Google Sheets, or open a new chat in Claude (${CLAUDE_URL}) and paste something like: 'Scan these for [the specific topics: X, Y, Z]. If the data is there, walk me through ways to visualise it and use it to test a new idea.'"
  · Only cite a documentation link for a tool they ACTUALLY use (from the list above). If none is known, keep the source generic ("your POS / analytics export") but still give the Claude step.
  · Frame it as validating whether the data even exists — that's the point of the exercise.
- This is the difference between "pull some reports and use AI" (vague) and a tangible, do-it-this-week path. Be specific and real.
- At most one or two numbers in the story part. No jargon. Warm, sharp, like a smart operator who's been there.
- Analyze, don't fully implement — name the leak, give the tangible first move, then stop. The full build / done-for-you is the paid upsell, so end with a soft line inviting them to reply if they'd rather have help or hand it off.
- Keep it tight: ~220–320 words of body (the sources block earns the extra length).

LANGUAGE: Write subject and body in ${lang} (keep URLs and tool names as-is). Return ONLY valid JSON, no markdown fences:
{"subject": "...", "body": "...", "area": "${PILLAR_LABEL[weakest]}"}`

  let parsed: any = null
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
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
