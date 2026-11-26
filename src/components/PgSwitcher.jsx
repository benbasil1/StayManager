import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

// Clean dropdown for switching between PGs (replaces the browser's native select popup).
export default function PgSwitcher({ properties, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = properties.find((p) => p.id === value) || properties[0]

  useEffect(() => {
    if (!open) return
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div className="pg-switch" ref={ref}>
      <button type="button" className={'pg-trigger' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label="Switch PG">
        <span className="pg-name">{current?.name}</span>
        <svg className="pg-caret" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="pg-menu" role="listbox" aria-label="Your PGs">
          {properties.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={p.id === current?.id} className={'pg-opt' + (p.id === current?.id ? ' active' : '')} onClick={() => { setOpen(false); if (p.id !== current?.id) onChange(p.id) }}>
                <span>{p.name}</span>
                {p.id === current?.id && <Icon name="check" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
