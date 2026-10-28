import Icon from './Icon'

export default function Toasts({ toasts, onOpen, onDismiss }) {
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <button className="toast-main" onClick={() => { onOpen(); onDismiss(t.id) }}>
            <strong>{t.title}</strong>
            <span className="clamp2">{t.text}</span>
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  )
}
