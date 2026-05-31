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
  strategy:     'long-term direction, capacity constraints, risk tolerance, pricing strategy, and operational bottlenecks',
  tools:        'the tech stack (POS, CRM, scheduling, accounting, loyalty), what data it produces, and whether the owner actually uses that data',
  people:       'team stability, retention, culture, how much relies on the owner personally, and what is at risk if a key person leaves',
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

  // Solo owners (no staff) get the People section reframed around owner-dependency
  // and continuity instead of team/staff churn questions that assume employees.
  const isSolo = businessProfile?.has_employees === false
  const pillarFocus = (pillarName === 'people' && isSolo)
    ? 'owner dependency and business continuity: what happens if the owner cannot work for a stretch, whether anyone could step in, what they would hand off or delegate first if they could afford help, and how much of the business exists only in the owner\'s head'
    : (PILLAR_FOCUS[pillarName] || pillarName)

  const soloPeopleGuard = (pillarName === 'people' && isSolo)
    ? `\n\nIMPORTANT — THIS OWNER RUNS THE BUSINESS SOLO (no employees):
Do NOT ask about staff retention, team churn, hiring, who might leave, or workplace culture — they have no team. Instead explore owner-dependency and continuity: what happens if they're out for two weeks, whether anyone (family, a freelancer, a peer) could cover, the single task they'd most want to offload to a cheap hire, and what only exists in their head.`
    : ''

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

  const profileBlock = businessProfile ? `Business: ${businessProfile.business_type} (${businessProfile.industry}) — ${businessProfile.business_description || 'no description yet'}
Owner tone: ${businessProfile.owner_tone || 'unknown'}` : ''

  const systemPrompt = `You are a sharp, warm business diagnostic consultant — not a survey bot. You're working through a structured diagnostic one section at a time. Right now you are covering: ${pillarLabel.toUpperCase()}.

${profileBlock}

${prevContext ? `WHAT YOU ALREADY KNOW FROM EARLIER SECTIONS:\n${prevContext}` : 'This is the first section.'}

YOUR MISSION FOR THIS SECTION — ${pillarLabel.toUpperCase()}:
Get enough data to write a genuinely useful diagnostic for: ${pillarFocus}${soloPeopleGuard}

QUESTION BANK FOR THIS SECTION (use as inspiration — adapt freely, reorder, skip if irrelevant, add your own if the conversation leads somewhere better):
${questionBank}

HOW TO WORK:
- You are a consultant, not a form. Use the question bank as a menu, not a script.
- If the owner's answer to one question reveals the answer to another, don't ask the redundant one.
- If the conversation opens a better angle, take it.
- If something from an earlier section is directly relevant here, connect it — "you mentioned earlier that you use Lightspeed, does that mean you can see..."
- Probe for specifics: tools named, numbers cited, direct experience vs gut feel.
- Match the owner's energy. If they're brief, be efficient. If they're expansive, follow the thread.

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
