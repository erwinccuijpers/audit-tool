import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Correct the lead email across all of a session's product_interests rows
// (it's one person — keep their email consistent everywhere).
export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { sessionId, email } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'No session ID' }, { status: 400 })
  const e = String(email || '').trim()
  if (!EMAIL_RE.test(e)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

  const { error } = await supabase
    .from('product_interests')
    .update({ email: e, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, email: e })
}
