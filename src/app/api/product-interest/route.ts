import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const PRODUCTS = ['newsletter', 'work_your_plan', 'open_suggestions'] as const
const STATUSES = ['interested', 'not_interested'] as const

// One generic endpoint for any product-interest toggle on the client dashboard.
// Tables are service-role only (RLS), so all writes go through here.
export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { sessionId, productKey, status, email, note } = await req.json()
  if (!sessionId) return NextResponse.json({ error: 'No session ID' }, { status: 400 })
  if (!PRODUCTS.includes(productKey)) return NextResponse.json({ error: 'Bad product' }, { status: 400 })
  if (!STATUSES.includes(status)) return NextResponse.json({ error: 'Bad status' }, { status: 400 })

  // Stamp email/user/is_test from the session so leads are clean and test runs excluded.
  const { data: session } = await supabase
    .from('sessions')
    .select('user_id, is_test')
    .eq('id', sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const row: Record<string, any> = {
    session_id: sessionId,
    product_key: productKey,
    status,
    email: email || null,
    user_id: session.user_id ?? null,
    is_test: session.is_test ?? false,
    updated_at: new Date().toISOString(),
  }
  if (typeof note === 'string' && note.trim()) row.note = note.trim().slice(0, 2000)

  // Upsert on (session_id, product_key) — toggling just flips status.
  const { error } = await supabase
    .from('product_interests')
    .upsert(row, { onConflict: 'session_id,product_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, status })
}

// Read current interest state for a session (so the dashboard renders toggles correctly).
export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) return NextResponse.json({ error: 'No session ID' }, { status: 400 })

  const { data } = await supabase
    .from('product_interests')
    .select('product_key, status, email')
    .eq('session_id', sessionId)

  const interests: Record<string, string> = {}
  let email: string | null = null
  for (const r of data || []) {
    interests[r.product_key] = r.status
    if (r.email) email = r.email
  }
  return NextResponse.json({ interests, email })
}
