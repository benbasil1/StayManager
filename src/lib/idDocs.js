// ID proof documents (Aadhaar, PAN, etc.) and payment screenshots.
// Live mode: photos are shrunk in the browser, then saved in the Turso database through the API
//            (paths look like  turso:<id>.jpg  or  turso:<id>.pdf).
//            Older files that were uploaded to Supabase Storage (paths without "turso:") still open and delete as before.
// Demo mode: photos are shrunk and kept in this browser only.
import { isSupabaseConfigured, supabase } from './supabase'
import { compressImage } from './compress'
import { deleteFile, downloadFileUrl, uploadFile } from './api'

const BUCKET = 'tenant-docs' // legacy files only
const MAX_PICK_BYTES = 25 * 1024 * 1024 // a phone photo before shrinking
const MAX_PDF_BYTES = 1.5 * 1024 * 1024 // PDFs cannot be shrunk

export const isPdf = (path = '') => /\.pdf$/i.test(path) || path.startsWith('data:application/pdf')
const isTurso = (path = '') => path.startsWith('turso:')

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

// Returns the "path" that is saved on the tenant / payment
export async function addIdDoc(tenantId, file) {
  const isImage = file.type.startsWith('image/')
  const pdf = file.type === 'application/pdf'
  if (!isImage && !pdf) throw new Error('Please choose a photo or a PDF.')
  if (file.size > MAX_PICK_BYTES) throw new Error('File is larger than 25 MB.')
  if (pdf && file.size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 1.5 MB. Please use a photo of it instead, or a smaller PDF.')

  if (!isSupabaseConfigured) {
    if (!isImage) throw new Error('Demo mode accepts photos only. PDFs work once the app is connected.')
    return shrinkToDataUrl(file)
  }

  const body = isImage ? await compressImage(file) : file
  return uploadFile(tenantId, body, file.name)
}

// ----- opening files -----
// Files need the login token, so they are fetched and shown through a temporary local link.
// The last few opened files are remembered, so viewing one again does not download it again.
const cache = new Map() // path -> local blob link
const CACHE_MAX = 8

export async function getIdDocUrl(path) {
  if (path.startsWith('data:')) return path
  if (isTurso(path)) {
    if (cache.has(path)) return cache.get(path)
    const url = await downloadFileUrl(path)
    cache.set(path, url)
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      URL.revokeObjectURL(cache.get(oldest))
      cache.delete(oldest)
    }
    return url
  }
  // legacy file in Supabase Storage
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300) // link works for 5 minutes
  if (error) throw error
  return data.signedUrl
}

export async function removeIdDoc(path) {
  if (path.startsWith('data:')) return
  if (isTurso(path)) {
    if (cache.has(path)) {
      URL.revokeObjectURL(cache.get(path))
      cache.delete(path)
    }
    return deleteFile(path)
  }
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
