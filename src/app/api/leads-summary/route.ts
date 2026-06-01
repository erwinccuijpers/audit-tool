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
    .select('product_key, status, email, session_id')
    .eq('is_test', mode === 'demo')

  const summary: Record<string, { interested: number; not_interested: number }> = {
    newsletter: { interested: 0, not_interested: 0 },
    work_your_plan: { interested: 0, not_interested: 0 },
  }
  const emails = new Set<string>()
  for (const r of data || []) {
    if (!summary[r.product_key]) summary[r.product_key] = { interested: 0, not_interested: 0 }
    if (r.status === 'interested') summary[r.product_key].interested += 1
    else if (r.status === 'not_interested') summary[r.product_key].not_interested += 1
    if (r.status === 'interested' && r.email) emails.add(r.email)
  }

  return NextResponse.json({ summary, uniqueInterestedEmails: emails.size })
}
