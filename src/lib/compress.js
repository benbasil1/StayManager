// Shrinks a photo before it is uploaded, so each ID photo / payment screenshot takes
// roughly 100-500 KB of database space instead of 3-8 MB.
//  - longest side is limited (text on an ID card stays readable at 1600 px)
//  - saved as JPEG (PNG screenshots become much smaller)
//  - tries lower quality / smaller size only if the result is still too big
const SIDES = [1600, 1280, 1000]
const QUALITIES = [0.72, 0.6, 0.5]
const TARGET_BYTES = 500 * 1024
const KEEP_AS_IS_BYTES = 250 * 1024 // small JPEGs are not re-compressed (avoids needless quality loss)

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file) // respects the phone's rotation (EXIF)
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image. Try a JPG or PNG photo.')) }
    img.src = url
  })
}

const toBlob = (canvas, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))

export async function compressImage(file) {
  if (file.type === 'image/jpeg' && file.size <= KEEP_AS_IS_BYTES) return file
  const img = await decode(file)
  const w = img.width || img.naturalWidth
  const h = img.height || img.naturalHeight
  if (!w || !h) throw new Error('Could not read this image. Try a JPG or PNG photo.')
  let best = null
  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // transparent PNGs would turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, q)
      if (!blob) throw new Error('Could not shrink this image. Try a different photo.')
      if (!best || blob.size < best.size) best = blob
      if (blob.size <= TARGET_BYTES) return blob
    }
  }
  if (img.close) img.close()
  return best
}
