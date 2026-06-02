'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type NavKey = 'hub' | 'dashboard' | 'results' | 'history'

const ITEMS: { key: NavKey; label: string; desc: string; path: (id: string) => string }[] = [
  { key: 'hub',       label: 'Dashboard',    desc: 'Your home base',        path: id => `/hub?session=${id}` },
  { key: 'dashboard', label: 'Your 7 areas', desc: 'Section-by-section',    path: id => `/dashboard?session=${id}` },
  { key: 'results',   label: 'Report',       desc: 'Scores & opportunities', path: id => `/results?session=${id}` },
  { key: 'history',   label: 'Transcript',   desc: 'Full conversation',     path: id => `/history?session=${id}` },
]

// Lead-gen offers — these live on the hub as cards but are reachable from the
// menu on every surface. Each deep-links to the hub with a ?panel= param the
// hub reads on mount to auto-open the matching panel.
const LEAD_ITEMS: { key: string; label: string; desc: string; path: (id: string) => string }[] = [
  { key: 'briefing',   label: 'Personalized newsletter', desc: 'A sample written for you',       path: id => `/hub?session=${id}&panel=briefing` },
  { key: 'workplan',   label: 'Keep working with your data', desc: 'Put the plan to work',       path: id => `/hub?session=${id}&panel=workplan` },
  { key: 'suggestion', label: 'Work with us',            desc: 'Send a suggestion or request',   path: id => `/hub?session=${id}&panel=suggestion` },
]

// Shared client-side top bar with a hamburger menu. Used on every post-interview
// surface (hub, dashboard, report, transcript) so navigation is consistent and
// the user never gets dropped back into the raw interview chrome.
export default function ClientNav({ sessionId, active, businessName, actions, className }: {
  sessionId: string | null
  active: NavKey
  businessName?: string
  actions?: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const go = (path: string) => { setOpen(false); router.push(path) }

  return (
    <div className={className} style={{
      position: 'sticky', top: 0, zIndex: 50, background: '#0F0F0B',
      borderBottom: '1px solid #1A1A14', padding: '11px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* Hamburger */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Menu"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
          display: 'flex', flexDirection: 'column', gap: 3, color: '#8A8070',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#C8A96E')}
        onMouseLeave={e => (e.currentTarget.style.color = '#8A8070')}
      >
        {[0, 1, 2].map(i => (
          <span key={i} style={{ display: 'block', width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
        ))}
      </button>

      <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.18em', color: '#3A3A28' }}>POCKET CMO</span>
      {businessName && (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#C8A96E' }}>{businessName}</span>
      )}

      {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>{actions}</div>}

      {/* Dropdown */}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 12, zIndex: 60,
            background: '#111110', border: '1px solid #1E1E14', borderRadius: 10,
            minWidth: 220, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {ITEMS.map(it => {
              const isActive = it.key === active
              return (
                <button
                  key={it.key}
                  onClick={() => sessionId && go(it.path(sessionId))}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: isActive ? '#1A1A14' : 'transparent', border: 'none',
                    borderRadius: 7, padding: '10px 12px', cursor: 'pointer',
                    marginBottom: 2, transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#161614' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, color: isActive ? '#C8A96E' : '#D0C8B8' }}>{it.label}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4A4A38', marginTop: 1 }}>{it.desc}</div>
                </button>
              )
            })}

            <div style={{ height: 1, background: '#1E1E14', margin: '6px 8px' }} />
            <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.14em', color: '#3A3A28', padding: '4px 12px 6px' }}>GET INVOLVED</div>
            {LEAD_ITEMS.map(it => (
              <button
                key={it.key}
                onClick={() => sessionId && go(it.path(sessionId))}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  borderRadius: 7, padding: '10px 12px', cursor: 'pointer',
                  marginBottom: 2, transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#161614' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, color: '#D0C8B8' }}>{it.label}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4A4A38', marginTop: 1 }}>{it.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
