// Small "i" button that shows / hides a field's description.
// The description text itself lives with each field and is passed in as `info`.
import { useState } from 'react'

export function InfoBtn({ open, onClick, label = 'What is this?' }) {
  return (
    <button type="button" className="info-btn" aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      i
    </button>
  )
}

export function InfoPanel({ children }) {
  return <div className="info-pop" role="note">{children}</div>
}

// Section title with an "i" button; the description opens right below it.
export function SectionHead({ title, info }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="head-info">
        <h3>{title}</h3>
        {info && <InfoBtn open={open} onClick={() => setOpen((o) => !o)} label={`About ${title}`} />}
      </div>
      {info && open && <InfoPanel>{info}</InfoPanel>}
    </>
  )
}
