// ID proof documents (Aadhaar, PAN, etc.)
// Supabase mode: files go to the PRIVATE "tenant-docs" storage bucket and are opened with short-lived links.
// Demo mode: photos are shrunk and kept in this browser only.
import { isSupabaseConfigured, supabase } from './supabase'

const BUCKET = 'tenant-docs'
const MAX_BYTES = 8 * 1024 * 1024

export const isPdf = (path = '') => /\.pdf$/i.test(path) || path.startsWith('data:application/pdf')

function shrinkToDataUrl(file, maxSide = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image. Try a JPG or PNG photo.'))
    }
    img.src = url
  })
}

// Returns the "path" that is saved on the tenant (storage path, or a data URL in demo mode)
export async function addIdDoc(tenantId, file) {
  if (file.size > MAX_BYTES) throw new Error('File is larger than 8 MB.')
  const isImage = file.type.startsWith('image/')
  const pdf = file.type === 'application/pdf'
  if (!isImage && !pdf) throw new Error('Please choose a photo or a PDF.')

  if (!isSupabaseConfigured) {
    if (!isImage) throw new Error('Demo mode accepts photos only. PDFs work once Supabase is connected.')
    return shrinkToDataUrl(file)
  }

  const { data } = await supabase.auth.getUser()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${data.user.id}/${tenantId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw error
  return path
}

export async function getIdDocUrl(path) {
  if (path.startsWith('data:')) return path
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300) // link works for 5 minutes
  if (error) throw error
  return data.signedUrl
}

export async function removeIdDoc(path) {
  if (path.startsWith('data:')) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
