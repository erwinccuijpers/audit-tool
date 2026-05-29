import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { feedbackId, sessionId, feedbackType, feedbackText, feedbackCategory, errorContext } = await req.json()
  if (!feedbackId) return NextResponse.json({ error: 'feedbackId required' }, { status: 400 })

  // Fetch session data
  let session: any = null
  let recentResponses: any[] = []
  let userEmail: string | null = null

  if (sessionId) {
    const { data: s } = await supabaseAdmin.from('sessions').select('*').eq('id', sessionId).single()
    session = s

    if (session?.user_id) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(session.user_id)
        userEmail = user?.email ?? null
      } catch { /* service role not available, skip */ }
    }

    const { data: responses } = await supabaseAdmin
      .from('responses')
      .select('question_id, conversation, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(5)
    recentResponses = responses || []
  }

  const completedSummaries = session?.completed_summaries || []
  const answeredCount = session?.answered_ids?.length ?? completedSummaries.length
  const sessionSnapshot = {
    business_name: session?.business_name,
    business_type: session?.business_type,
    industry: session?.industry,
    status: session?.status,
    language: session?.language,
    has_employees: session?.has_employees,
    answered_count: answeredCount,
    completed_categories: [...new Set(completedSummaries.map((s: any) => s.category).filter(Boolean))],
    recent_summaries: completedSummaries.slice(-3),
    recent_responses: recentResponses.map(r => ({ question_id: r.question_id, turns: r.conversation?.length ?? 0 })),
  }

  // Build Claude prompt
  const isBug = feedbackType === 'bug'
  const contextStr = errorContext ? JSON.stringify(errorContext, null, 2) : 'not available'

  const prompt = isBug
    ? `You are analyzing a bug report from a user of Pocket CMO, an AI-powered business diagnostic interview tool.

USER FEEDBACK (category: ${feedbackCategory}):
"${feedbackText}"

SESSION STATE:
- Business: ${session?.business_name || 'Unknown'} (${session?.business_type || '?'}, ${session?.industry || '?'})
- Progress: ${answeredCount} questions answered
- Status: ${session?.status || 'unknown'}
- Current question from context: ${errorContext?.currentQuestion || 'unknown'}
- Phase: ${errorContext?.phase || 'unknown'}
- URL when it happened: ${errorContext?.url || 'unknown'}

RECENT RESPONSES: ${recentResponses.map(r => r.question_id).join(', ') || 'none'}

TECHNICAL CONTEXT:
${contextStr}

Write a structured debug report with these exact sections:
STAGE: One sentence on where in the interview they were and what they were doing.
LIKELY CAUSE: One or two sentences on the most probable technical reason for the issue based on the context.
PRIORITY: HIGH / MEDIUM / LOW and why in one sentence.
REPRODUCE: Steps that would likely reproduce this (2-3 bullet points).
NOTE: Any other relevant detail for the developer.`

    : `You are analyzing product feedback from a user of Pocket CMO, an AI-powered business diagnostic interview tool.

USER FEEDBACK on the ${feedbackCategory} recommendation:
"${feedbackText}"

RECOMMENDATION THEY WERE RESPONDING TO:
"${errorContext?.recommendation || 'not captured'}"

SESSION STATE:
- Business: ${session?.business_name || 'Unknown'} (${session?.business_type || '?'}, ${session?.industry || '?'})
- Progress: ${answeredCount} questions answered in ${feedbackCategory} and other areas
- Recent summaries: ${completedSummaries.slice(-3).map((s: any) => s.summary).join(' | ') || 'none'}

Write a structured analysis with these exact sections:
VALIDITY: Is this feedback likely valid or a misunderstanding? One sentence.
ROOT CAUSE: Why might the recommendation have missed the mark? One sentence.
DATA GAP: What additional data from the interview would have improved this recommendation?
ACTION: What should change — question bank, system prompt, or report generation logic?`

  let aiSummary = ''
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    aiSummary = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  } catch (e) {
    aiSummary = 'Analysis failed.'
  }

  // Update feedback record
  await supabaseAdmin.from('feedback').update({
    session_snapshot: sessionSnapshot,
    ai_summary: aiSummary,
    ...(userEmail ? { user_email: userEmail } : {}),
  }).eq('id', feedbackId)

  return NextResponse.json({ ok: true })
}
