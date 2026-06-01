import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Service-role summary of product_interests for the admin dashboard (RLS blocks the anon key).
// Respects the Real/Demo split via ?mode=real|demo (is_test false/true).
export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const mode = req.nextUrl.searchParams.get('mode') === 'demo' ? 'demo' : 'real'

  const { data } = await supabase
    .from('product_interests')
    .select('product_key, status, email, session_id, note, created_at')
    .eq('is_test', mode === 'demo')
    .order('created_at', { ascending: false })

  // Pull business name + completion status for each lead's session (the high-value signal).
  const sessionIds = [...new Set((data || []).map(r => r.session_id).filter(Boolean))]
  const sessionMap: Record<string, { business_name: string; completed: boolean }> = {}
  if (sessionIds.length > 0) {
    const { data: sess } = await supabase
      .from('sessions')
      .select('id, business_name, status')
      .in('id', sessionIds)
    for (const s of sess || []) {
      sessionMap[s.id] = {
        business_name: s.business_name || '',
        completed: s.status === 'completed' || s.status === 'interview_done',
      }
    }
  }

  const summary: Record<string, { interested: number; not_interested: number }> = {
    newsletter: { interested: 0, not_interested: 0 },
    work_your_plan: { interested: 0, not_interested: 0 },
    open_suggestions: { interested: 0, not_interested: 0 },
  }
  const emails = new Set<string>()
  const suggestions: { email: string | null; note: string; created_at: string; business_name: string }[] = []
  // Interested leads with an email, for export
  const leads: { product_key: string; email: string; created_at: string; business_name: string; completed: boolean }[] = []

  for (const r of data || []) {
    if (!summary[r.product_key]) summary[r.product_key] = { interested: 0, not_interested: 0 }
    if (r.status === 'interested') summary[r.product_key].interested += 1
    else if (r.status === 'not_interested') summary[r.product_key].not_interested += 1

    const sm = r.session_id ? sessionMap[r.session_id] : undefined
    if (r.status === 'interested' && r.email) {
      emails.add(r.email)
      leads.push({
        product_key: r.product_key,
        email: r.email,
        created_at: r.created_at,
        business_name: sm?.business_name || '',
        completed: sm?.completed || false,
      })
    }
    if (r.product_key === 'open_suggestions' && (r as any).note) {
      suggestions.push({
        email: r.email,
        note: (r as any).note,
        created_at: r.created_at,
        business_name: sm?.business_name || '',
      })
    }
  }

  return NextResponse.json({ summary, uniqueInterestedEmails: emails.size, suggestions, leads })
}
