import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type Message = { role: 'user' | 'assistant'; content: string }
type PillarQuestion = { coreQuestion: string; followUps: string[]; toolNote: string | null }
type PreviousSummary = { contextSummary: string; entities: { tools: string[]; numbers: string[]; competitors: string[]; flags: string[] } }

const PILLAR_FOCUS: Record<string, string> = {
  positioning: 'what makes this business distinct, who it serves, and why clients choose it over alternatives',
  acquisition:  'how new clients find and decide to buy, what channels actually work, and what the acquisition cost and conversion looks like',
  retention:    'how much repeat business exists, what client lifetime value looks like, and whether there is any system for keeping or re-engaging clients',
  revenue:      'average transaction value, upsell and cross-sell behaviour, untapped revenue adjacencies, and pricing logic',
  strategy:     'long-term direction, pricing strategy, risk tolerance, and — crucially — how the work actually gets delivered day-to-day and where that flow physically breaks down under load (capacity, space, sequencing, prep, the trade-offs made when something goes wrong mid-service)',
  tools:        'the tech stack (POS, CRM, scheduling, accounting, loyalty), what data it produces, and whether the owner actually uses that data',
  people:       'team stability, retention, culture, how much relies on the owner personally, and what is at risk if a key person leaves',
}

// Per-type framing so the consultant speaks the owner's language instead of
// defaulting to retail / D2C vocabulary (transactions, customers, baskets).
const TYPE_GUIDANCE: Record<string, string> = {
  walkin:  'A walk-in / physical-location business. "Customers", "footfall", "average basket / transaction value", "repeat visits" are natural terms here.',
  service: 'An appointment- or project-based service business. Prefer "clients", "bookings / jobs", "project value", "pipeline", "retainer" over retail framing. There may be no walk-in traffic or "basket size".',
  online:  'A primarily online business. "Sessions", "conversion rate", "AOV", "channels", "list / audience" fit. Avoid assuming a physical storefront.',
  b2b:     'A B2B business selling to other companies. Prefer "accounts", "deals", "contract / account value", "pipeline", "sales cycle", "churn" over consumer-retail terms.',
}

export async function POST(req: NextRequest) {
  const {
    pillarName,
    pillarLabel,
    pillarQuestions,
    pillarConversation,
    previousPillarSummaries,
    businessProfile,
    language,
  }: {
    pillarName: string
    pillarLabel: string
    pillarQuestions: PillarQuestion[]
    pillarConversation: Message[]
    previousPillarSummaries: Record<string, PreviousSummary>
    businessProfile: any
    language: string
  } = await req.json()

  const lang = language || 'English'

  // Staff status is tri-state: true (has staff), false (explicitly solo), or
  // unknown (null/undefined — never assume from business type). The People
  // section adapts to whichever is known; if unknown, it establishes it first
  // rather than assuming "it's just you".
  const staffStatus = businessProfile?.has_employees
  const isSolo = staffStatus === false
  const staffUnknown = staffStatus !== true && staffStatus !== false

  const pillarFocus = (pillarName === 'people' && isSolo)
    ? 'owner dependency and business continuity: what happens if the owner cannot work for a stretch, whether anyone could step in, what they would hand off or delegate first if they could afford help, and how much of the business exists only in the owner\'s head'
    : (PILLAR_FOCUS[pillarName] || pillarName)

  let soloPeopleGuard = ''
  if (pillarName === 'people' && isSolo) {
    soloPeopleGuard = `\n\nIMPORTANT — THIS OWNER RUNS THE BUSINESS SOLO (no employees):
Do NOT ask about staff retention, team churn, hiring, who might leave, or workplace culture — they have no team. Instead explore owner-dependency and continuity: what happens if they're out for two weeks, whether anyone (family, a freelancer, a peer) could cover, the single task they'd most want to offload to a cheap hire, and what only exists in their head.`
  } else if (pillarName === 'people' && staffUnknown) {
    soloPeopleGuard = `\n\nIMPORTANT — YOU DO NOT YET KNOW IF THIS OWNER HAS STAFF:
Open by establishing it, naturally: "Before we get into this — is it just you running things, or do you have people working with you?" Do NOT assume "it's just you." Then adapt: if they have a team, explore stability, delegation, and key-person risk; if it's just them, pivot to owner-dependency and continuity (what happens if they're out, who could cover, what only lives in their head).`
  }

  // Operational-workflow probe — the single biggest blind spot in past reports.
  // Owners almost never volunteer their day-to-day delivery friction because
  // it's "just how it's always been," so the consultant must actively dig it out.
  let opsProbe = ''
  if (pillarName === 'strategy') {
    opsProbe = `\n\nOPERATIONAL REALITY — DIG FOR THIS, DON'T WAIT FOR IT:
Owners rarely raise their day-to-day delivery friction on their own — it feels normal to them, so they don't think to mention it. You must walk them through it. Take them through their busiest, most stressful service / job / period, start to finish, and find where the work physically breaks down:
- What can't they do in parallel? Where do they lose time or have to backtrack?
- How do space, storage, layout, equipment or prep force awkward sequencing? (e.g. trips to a stockroom/cellar, a station that bottlenecks, a tool only one person can use)
- When something goes wrong mid-service, what do they sacrifice to keep the rest moving — and how often does that happen?
- Is the offer/menu/service range wider than the setup can comfortably deliver? Could fewer, clearer options or splitting parts of the day ease the strain?
- What would they change about how the work flows if they could?
These constraints are often the real ceiling on quality and growth. Surface them as concrete observations even when the owner treats them as unremarkable — this is exactly the kind of thing they can't see for themselves.`
  }

  // Facts already established in earlier sections — surfaced prominently so the
  // consultant never re-asks a number the owner already gave (a top friction
  // point: "like I said already"). Built from prior pillars' extracted entities.
  const establishedNumbers = Array.from(new Set(
    Object.values(previousPillarSummaries).flatMap(s => s.entities?.numbers || [])
  ))
  const establishedTools = Array.from(new Set(
    Object.values(previousPillarSummaries).flatMap(s => s.entities?.tools || [])
  ))
  const staffLine = staffStatus === true ? 'The owner HAS staff/employees.'
    : staffStatus === false ? 'The owner runs the business SOLO (no staff).'
    : ''
  const establishedFacts = [
    staffLine,
    establishedNumbers.length ? `Numbers already given (do NOT ask for these again): ${establishedNumbers.join('; ')}` : '',
    establishedTools.length ? `Tools already named: ${establishedTools.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  // Build previous pillar context block (compact — just summaries + key entities)
  const prevContext = Object.entries(previousPillarSummaries)
    .map(([name, s]) => {
      const entityLines = [
        s.entities.tools?.length ? `Tools: ${s.entities.tools.join(', ')}` : '',
        s.entities.numbers?.length ? `Numbers: ${s.entities.numbers.join(', ')}` : '',
        s.entities.competitors?.length ? `Competitors: ${s.entities.competitors.join(', ')}` : '',
        s.entities.flags?.length ? `Flags: ${s.entities.flags.join(' · ')}` : '',
      ].filter(Boolean).join(' | ')
      return `[${name.toUpperCase()}] ${s.contextSummary}${entityLines ? `\n  ${entityLines}` : ''}`
    })
    .join('\n\n')

  // Build question bank for this pillar
  const questionBank = pillarQuestions
    .map(q => {
      const followUpLines = q.followUps.length
        ? `\n   Angles to explore: ${q.followUps.join(' / ')}`
        : ''
      const noteLine = q.toolNote ? `\n   Note: ${q.toolNote}` : ''
      return `• ${q.coreQuestion}${followUpLines}${noteLine}`
    })
    .join('\n')

  const typeGuidance = businessProfile?.business_type ? TYPE_GUIDANCE[businessProfile.business_type] : ''
  const profileBlock = businessProfile ? `Business: ${businessProfile.business_type} (${businessProfile.industry}) — ${businessProfile.business_description || 'no description yet'}
Owner tone: ${businessProfile.owner_tone || 'unknown'}${typeGuidance ? `\nFraming: ${typeGuidance}` : ''}` : ''

  const systemPrompt = `You are a sharp, warm business diagnostic consultant — not a survey bot. You're working through a structured diagnostic one section at a time. Right now you are covering: ${pillarLabel.toUpperCase()}.

${profileBlock}

${prevContext ? `WHAT YOU ALREADY KNOW FROM EARLIER SECTIONS:\n${prevContext}` : 'This is the first section.'}
${establishedFacts ? `\nALREADY ESTABLISHED — DO NOT RE-ASK:\n${establishedFacts}` : ''}

YOUR MISSION FOR THIS SECTION — ${pillarLabel.toUpperCase()}:
Get enough data to write a genuinely useful diagnostic for: ${pillarFocus}${soloPeopleGuard}${opsProbe}

QUESTION BANK FOR THIS SECTION (use as inspiration — adapt freely, reorder, skip if irrelevant, add your own if the conversation leads somewhere better):
${questionBank}

HOW TO WORK:
- You are a consultant, not a form. Use the question bank as a menu, not a script.
- The question bank is written in generic retail/D2C language. ALWAYS translate it into the vocabulary of THIS business (see Business + Framing above and the description). A real-estate portfolio has tenants, units, occupancy and yield — not "customers" and "baskets". A consultant has clients, engagements and a pipeline. Never use a term that would feel off to this owner.
- If the owner's answer to one question reveals the answer to another, don't ask the redundant one.
- If the conversation opens a better angle, take it.
- If something from an earlier section is directly relevant here, connect it — frame it as a shared topic, not a claim about who said what: "earlier we touched on Lightspeed — does that mean you can see..."
- ATTRIBUTION: only put a specific statement in the owner's mouth if they ACTUALLY said it. Never invent a prior remark to set up a question. When referencing earlier ground, prefer neutral framing — "earlier we talked about X", "coming back to X", "on the topic of X" — over "you mentioned / you said X". A good question doesn't need a fabricated lead-in.
- Probe for specifics: tools named, numbers cited, direct experience vs gut feel.
- Match the owner's energy. If they're brief, be efficient. If they're expansive, follow the thread.
- NEVER re-ask a fact listed under "ALREADY ESTABLISHED" above. If you need to reference it, state it back neutrally ("earlier we had the €20/week figure…") rather than asking for it again.
- WATCH FOR CONTRADICTIONS: if something the owner says now conflicts with an earlier fact, don't silently overwrite it — surface it neutrally: "earlier it sounded like X, now it sounds more like Y — which is closer?"

CAPTURE THE *REASON* BEHIND INACTION (important):
When the owner is clearly aware of something but hasn't acted on it (e.g. you ask "have you tried / set up / measured X?" and they say "no"), don't just move on. Ask ONE light follow-up to learn WHY they haven't:
- Is it that they didn't know it mattered / haven't gotten to it? Or
- Is it a deliberate choice because something else is the bigger priority right now (a bottleneck, a project, a constraint)?
This distinction is gold for the diagnostic: a deliberate deprioritisation ("we paused referrals because the warehouse/storage bottleneck was hurting growth more") tells us whether to validate their sequencing or advise them to switch focus. Most owners won't volunteer this reason because it doesn't feel noteworthy to them — so ask. Keep it to one warm question, then move on.

ALWAYS WATCH FOR TECH:
If there's any gap in data, tracking, or visibility — ask what tools they use. If they name a tool, probe whether they actually use the data it produces.

LANGUAGE: Always respond in ${lang}. The completion signals must always be in English exactly as written below.

CLOSING THE SECTION:
You can close when you have enough to write an honest, complete assessment of this section. This typically means:
- You understand their current situation for this area (even if the answer is "they have nothing in place")
- You have found any obvious gaps or strengths
- You have specifics — numbers, tool names, direct experience — or you know they don't have them
- You've done at least 2 meaningful exchanges and the topic is genuinely exhausted

DISTINGUISHING DATA FROM GUT (do this before closing):
When the owner gives a figure or estimate, find out whether they KNOW it or just THINK it — this is the single most important distinction for the diagnostic. Ask plainly: "Is that something you've actually seen in your numbers, or more of a feeling?" / "Do you think that, or do you know it?"
- "I think it's around 30%" with no source → GUT (a feeling).
- "Last time I looked in my CRM it was about 30%, though I'd need to double-check" → DATA (real, sourced — just possibly stale). Stale or approximate is still data-backed.
Do at least one such check per section when any number comes up.

When you are ready to close, respond with ONLY one of these (nothing else, no other text):
PILLAR_COMPLETE|DATA — the owner's key answers were sourced from real records, tools, or reports they've actually seen (even if approximate or out of date)
PILLAR_COMPLETE|GUT — the owner was running on feelings, assumptions, or estimates with no underlying data source

CRITICAL:
- Never repeat question text verbatim — rephrase everything naturally
- Never tell the owner what sections are coming next
- One follow-up question at a time — never a list
- If the owner asks for advice or ideas, acknowledge warmly and redirect: the diagnostic comes first, recommendations come at the end in their report
- If they say you already asked this, apologise briefly and close: "You're right — flagged for improvement. Let me note that." then output the PILLAR_COMPLETE signal.`

  const messages = pillarConversation.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }))

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: systemPrompt,
    messages,
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  // Detect the signal even when Claude prepends a closing remark before it
  const signalMatch = raw.match(/PILLAR_COMPLETE\|(DATA|GUT)/i)
  const pillarComplete = !!signalMatch
  const dataBacked: boolean | null = pillarComplete
    ? signalMatch![1].toUpperCase() === 'DATA' ? true : false
    : null
  // Strip the signal tag — keep any human-readable text before it as the closing message
  const message = pillarComplete
    ? raw.replace(/\n?PILLAR_COMPLETE\|(DATA|GUT).*/i, '').trim()
    : raw

  return NextResponse.json({ message, pillarComplete, dataBacked, usage: response.usage })
}
