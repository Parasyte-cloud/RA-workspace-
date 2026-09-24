import { useEffect, useRef } from 'react'

/*
 * Shared wordmark used by every public forms page. Extracted out of
 * FormsApp.tsx (which used to be the only page) so PublicIntakeForm and
 * InvestorInterestForm can both use it without duplicating the canvas
 * background-removal logic.
 */
export function RideArrivoExactLogo() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'

    image.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight

      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)

      const frame = context.getImageData(0, 0, canvas.width, canvas.height)
      const pixels = frame.data

      /*
       * The supplied artwork has a dark navy background. Sample the actual
       * top-left background colour rather than hard-coding one, so this
       * keeps working if the artwork is ever swapped. This preserves the
       * exact white/orange artwork.
       */
      const backgroundR = pixels[0]
      const backgroundG = pixels[1]
      const backgroundB = pixels[2]

      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        const distance = Math.hypot(red - backgroundR, green - backgroundG, blue - backgroundB)

        // Completely remove the navy field, then feather only the
        // anti-aliased boundary pixels.
        if (distance <= 30) {
          pixels[index + 3] = 0
          continue
        }

        if (distance < 170) {
          const opacity = (distance - 30) / 140
          pixels[index + 3] = Math.round(pixels[index + 3] * opacity)
        }
      }

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.putImageData(frame, 0, 0)
    }

    image.src = '/ridearrivo-wordmark-forms-exact.png'

    return () => {
      cancelled = true
      image.onload = null
    }
  }, [])

  return (
    <a
      href="https://www.ridearrivo.com"
      className="formsLogoLink"
      aria-label="RideArrivo home"
    >
      <canvas
        ref={canvasRef}
        className="formsLogoCanvas"
        width={2048}
        height={682}
        role="img"
        aria-label="RideArrivo"
      />
    </a>
  )
}
