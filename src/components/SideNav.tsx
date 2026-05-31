'use client'
import { useRouter } from 'next/navigation'

type SideNavProps = {
  sessionId?: string
  isAnon?: boolean
  onSave?: () => void
}

export default function SideNav({ sessionId, isAnon, onSave }: SideNavProps) {
  const router = useRouter()
  const active = !!sessionId

  return (
    <>
    <style>{`
      @media (max-width: 639px) { .pocket-sidenav { display: none !important; } }
    `}</style>
    <div className="pocket-sidenav" style={{
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
        <span style={{ fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.06em' }}>DASHBOARD</span>
      </button>

      {/* Save progress icon — visible for anonymous users, disappears once signed in */}
      {isAnon && (
        <button
          title="Save your progress"
          onClick={onSave}
          style={{
            background: 'transparent', border: 'none',
            cursor: 'pointer',
            padding: '9px 0', width: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: '#8A5A30',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#C8A96E' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#8A5A30' }}
        >
          {/* Cloud upload / save icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 10V4M8 4L5.5 6.5M8 4L10.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3.5 10.5A2.5 2.5 0 0 0 4 15.5h8a2.5 2.5 0 0 0 .5-5 4 4 0 0 0-8-1A2.5 2.5 0 0 0 3.5 10.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.06em' }}>SAVE</span>
        </button>
      )}
    </div>
    </>
  )
}
