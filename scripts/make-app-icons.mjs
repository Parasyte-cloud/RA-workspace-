// Builds the installed-app icons from the two master artworks in brand/.
//   brand/workspace-gear.png        -> RA Workspace (intranet)   public/icons/icon-*.png, favicon.png
//   brand/arrivochauffeur-cap.png   -> ArrivoChauffeur           public/icons/chauffeur-*.png
// Run: node scripts/make-app-icons.mjs
// The masters are rounded tiles on a black square, so the corners are cut away
// here instead of being shown as black.
import sharp from 'sharp'
import fs from 'node:fs'

const NAVY = { r: 8, g: 22, b: 72, alpha: 1 }

async function tile(src) {
  // Rounded tile with transparent corners, at full master size.
  const { width: w, height: h } = await sharp(src).metadata()
  const inset = 5
  const radius = Math.round(w * 0.178)
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${radius}" fill="#fff"/></svg>`,
  )
  return sharp(src)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function build(src, out) {
  const rounded = await tile(src)
  const resize = size => sharp(rounded).resize(size, size, { kernel: 'lanczos3' }).png()

  await resize(192).toFile(`${out.dir}/${out.prefix}-192.png`)
  await resize(512).toFile(`${out.dir}/${out.prefix}-512.png`)

  // Maskable: the platform crops to a circle or squircle, so the whole tile is
  // shrunk into the safe zone and sits on a solid navy field.
  const inner = Math.round(512 * 0.6)
  const small = await sharp(rounded).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer()
  await sharp({ create: { width: 512, height: 512, channels: 4, background: NAVY } })
    .composite([{ input: small, gravity: 'center' }])
    .png()
    .toFile(`${out.dir}/${out.prefix}-maskable-512.png`)

  // iOS home screen icon: opaque square (iOS rounds it itself).
  const apple = await sharp(rounded).resize(180, 180, { kernel: 'lanczos3' }).png().toBuffer()
  await sharp({ create: { width: 180, height: 180, channels: 4, background: NAVY } })
    .composite([{ input: apple }])
    .flatten({ background: NAVY })
    .png()
    .toFile(`${out.dir}/${out.prefix}-apple-180.png`)

  return resize
}

fs.mkdirSync('public/icons', { recursive: true })

// RA Workspace keeps the file names the app, manifest and service worker already use.
const ws = await build('brand/workspace-gear.png', { dir: 'public/icons', prefix: 'workspace-tmp' })
fs.renameSync('public/icons/workspace-tmp-192.png', 'public/icons/icon-192.png')
fs.renameSync('public/icons/workspace-tmp-512.png', 'public/icons/icon-512.png')
fs.renameSync('public/icons/workspace-tmp-maskable-512.png', 'public/icons/icon-maskable-512.png')
fs.renameSync('public/icons/workspace-tmp-apple-180.png', 'public/icons/apple-180.png')
await ws(256).toFile('public/favicon.png')

await build('brand/arrivochauffeur-cap.png', { dir: 'public/icons', prefix: 'chauffeur' })
console.log('App icons written.')
