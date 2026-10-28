import { useRef, useState } from 'react'
import Icon from './Icon'
import { useData } from '../lib/store'
import { addIdDoc, getIdDocUrl, isPdf, removeIdDoc } from '../lib/idDocs'

const MAX_DEMO_DOCS = 2

export default function IdProof({ tenant }) {
  const { updateTenant, demo } = useData()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [view, setView] = useState(null) // { url, title }
  const docs = tenant.id_doc_paths || []

  async function onPick(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setMsg('')
    if (demo && docs.length >= MAX_DEMO_DOCS) {
      return setMsg('Demo mode keeps up to 2 photos per tenant. Connect Supabase for unlimited uploads.')
    }
    setBusy(true)
    try {
      const path = await addIdDoc(tenant.id, file)
      updateTenant(tenant.id, { id_doc_paths: [...docs, path] })
    } catch (err) {
      setMsg(err.message || 'Upload failed')
    }
    setBusy(false)
  }

  async function open(path, i) {
    setMsg('')
    try {
      const url = await getIdDocUrl(path)
      if (isPdf(path)) window.open(url, '_blank', 'noopener')
      else setView({ url, title: `${tenant.id_type || 'ID'} • document ${i + 1}` })
    } catch (err) {
      setMsg(err.message || 'Could not open the document')
    }
  }

  async function remove(path) {
    if (!window.confirm('Delete this document?')) return
    try {
      await removeIdDoc(path)
      updateTenant(tenant.id, { id_doc_paths: docs.filter((p) => p !== path) })
    } catch (err) {
      setMsg(err.message || 'Could not delete the document')
    }
  }

  return (
    <section className="t-section">
      <div className="panel-head">
        <h4>ID proof</h4>
        <button className="btn primary sm" onClick={() => fileRef.current.click()} disabled={busy}>
          <Icon name="plus" size={16} /> {busy ? 'Uploading…' : 'Add photo / PDF'}
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
      </div>

      <dl className="kv one">
        <div>
          <dt>ID type</dt>
          <dd>
            {tenant.id_type || 'Not set'}
            {tenant.id_last4 ? ` •••• ${tenant.id_last4}` : ''}
          </dd>
        </div>
      </dl>

      {docs.length === 0 && <p className="muted">No ID documents uploaded yet.</p>}
      {docs.map((p, i) => (
        <div className="id-row" key={p.slice(0, 80) + i}>
          <span>{isPdf(p) ? 'PDF' : 'Photo'} {i + 1}</span>
          <div>
            <button className="btn ghost sm" onClick={() => open(p, i)}>View</button>
            <button className="icon-btn danger" aria-label="Delete document" onClick={() => remove(p)}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      ))}
      {msg && <div className="notice err">{msg}</div>}

      {view && (
        <div className="lightbox" onClick={() => setView(null)}>
          <div className="lightbox-bar">
            <span>{view.title}</span>
            <button className="icon-btn" aria-label="Close" onClick={() => setView(null)}><Icon name="x" size={22} /></button>
          </div>
          <img src={view.url} alt={view.title} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  )
}
