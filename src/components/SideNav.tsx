'use client'
import { useRouter } from 'next/navigation'

type SideNavProps = {
  sessionId?: string
}

export default function SideNav({ sessionId }: SideNavProps) {
  const router = useRouter()
  const active = !!sessionId

  return (
    <div style={{
      width: 48, flexShrink: 0, background: '#09090605', borderRight: '1px solid #111110',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 10, gap: 2,
    }}>
      <div style={{
        color: '#1E1E16', fontFamily: 'monospace', fontSize: 8,
        letterSpacing: '0.12em', marginBottom: 10, userSelect: 'none',
      }}>
        CMO
      </div>

      {/* Dashboard overview icon */}
      <button
        title={active ? 'Overview dashboard' : 'Start the interview first'}
        onClick={() => active && router.push(`/dashboard?session=${sessionId}`)}
        style={{
          background: 'transparent', border: 'none',
          cursor: active ? 'pointer' : 'default',
          padding: '9px 0', width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          color: active ? '#4A4A38' : '#1E1E16',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => { if (active) (e.currentTarget as HTMLButtonElement).style.color = '#C8A96E' }}
        onMouseLeave={e => { if (active) (e.currentTarget as HTMLButtonElement).style.color = '#4A4A38' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
        <span style={{ fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.06em' }}>VIEW</span>
      </button>
    </div>
  )
}
