const MAX_PREVIEW_EDGE = 1400
const PREVIEW_QUALITY = 0.82

export function isPreviewableImage(file: File) {
  return file.type.startsWith('image/')
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Unable to create a preview for ${file.name}.`))
    }
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Unable to encode image preview.')),
      'image/webp',
      PREVIEW_QUALITY,
    )
  })
}

export async function createInternalImagePreview(file: File) {
  if (!isPreviewableImage(file)) return null

  const image = await loadImage(file)
  const width = Math.max(1, image.naturalWidth || image.width)
  const height = Math.max(1, image.naturalHeight || image.height)
  const scale = Math.min(1, MAX_PREVIEW_EDGE / width, MAX_PREVIEW_EDGE / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image preview rendering is unavailable in this browser.')

  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  // Preview copies are intentionally rasterised, reduced in size and watermarked.
  // The protected original stays in its private bucket until Admin grants download access.
  const fontSize = Math.max(14, Math.round(Math.min(canvas.width, canvas.height) * 0.035))
  context.save()
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(-Math.PI / 7)
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = 'rgba(255,255,255,0.28)'
  const stepX = Math.max(260, fontSize * 12)
  const stepY = Math.max(150, fontSize * 6)
  for (let y = -canvas.height; y <= canvas.height; y += stepY) {
    for (let x = -canvas.width; x <= canvas.width; x += stepX) {
      context.fillText('RIDEARRIVO INTERNAL PREVIEW', x, y)
    }
  }
  context.restore()

  return canvasToBlob(canvas)
}
