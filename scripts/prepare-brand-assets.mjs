import sharp from 'sharp'
import fs from 'node:fs'

async function removeNearWhite(input, output) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    if (r > 238 && g > 238 && b > 238) {
      data[i + 3] = 0
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toFile(output)
}

async function removeDarkNavy(input, output, size) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const darkNavy =
      r < 35 &&
      g < 65 &&
      b < 115

    if (darkNavy) {
      data[i + 3] = 0
    }
  }

  let image = sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })

  if (size) {
    image = image.resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  }

  await image.png().toFile(output)
}


async function makeWorkspaceWordmark(input, output) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const nearWhite =
      r > 238 &&
      g > 238 &&
      b > 238

    const navy =
      r < 80 &&
      g < 110 &&
      b < 150

    if (nearWhite) {
      data[i + 3] = 0
      continue
    }

    if (navy) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toFile(output)
}

fs.mkdirSync('public/icons', { recursive: true })

await removeNearWhite(
  'public/ridearrivo-wordmark.png',
  'public/ridearrivo-wordmark-transparent.png'
)

await makeWorkspaceWordmark(
  'public/ridearrivo-wordmark.png',
  'public/ridearrivo-wordmark-workspace.png'
)

await removeDarkNavy(
  'public/ridearrivo-mark.png',
  'public/favicon.png',
  256
)

await removeDarkNavy(
  'public/ridearrivo-mark.png',
  'public/icons/icon-192.png',
  192
)

await removeDarkNavy(
  'public/ridearrivo-mark.png',
  'public/icons/icon-512.png',
  512
)

console.log('RideArrivo transparent brand assets generated.')
