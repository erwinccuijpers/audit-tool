import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const ADMIN_EMAIL = 'erwinccuijpers@gmail.com'

type AdminEntry = { email: string; role: 'full' | 'readonly' }

function loadAdmins(cacheData: any): AdminEntry[] {
  if (cacheData?.admins) return cacheData.admins
  // Migrate old flat emails array — treat all as full
  const emails: string[] = cacheData?.emails ?? [ADMIN_EMAIL]
  return emails.map(e => ({ email: e, role: 'full' }))
}

export async function POST(req: NextRequest) {
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user: caller } } = await serviceClient.auth.getUser(token)
  if (!caller?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: cache } = await serviceClient
    .from('admin_cache')
    .select('data')
    .eq('key', 'admin_emails')
    .single()

  const admins = loadAdmins(cache?.data)
  const callerEntry = admins.find(a => a.email === caller.email)
    ?? (caller.email === ADMIN_EMAIL ? { email: caller.email, role: 'full' as const } : null)

  if (!callerEntry) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Only full admins can invite
  if (callerEntry.role !== 'full') return NextResponse.json({ error: 'Read-only admins cannot invite others' }, { status: 403 })

  const body = await req.json()
  const inviteEmail: string | undefined = body.email?.trim().toLowerCase()
  const role: 'full' | 'readonly' = body.role === 'readonly' ? 'readonly' : 'full'

  if (!inviteEmail) return NextResponse.json({ error: 'Email required' }, { status: 400 })
  if (admins.some(a => a.email === inviteEmail)) return NextResponse.json({ error: 'Already an admin' }, { status: 400 })

  const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(inviteEmail)
  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  const newAdmins: AdminEntry[] = [...admins, { email: inviteEmail, role }]
  await serviceClient
    .from('admin_cache')
    .upsert(
      { key: 'admin_emails', data: { admins: newAdmins }, sessions_count: 0, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

  return NextResponse.json({ ok: true })
}
