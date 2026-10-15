export function base64Url(
  bytes: Uint8Array,
) {
  let binary = ""

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function jwtPart(
  value: Record<string, unknown>,
) {
  return base64Url(
    new TextEncoder().encode(
      JSON.stringify(value),
    ),
  )
}
