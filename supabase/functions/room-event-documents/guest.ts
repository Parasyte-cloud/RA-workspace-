import { cleanText } from "./lib.ts"

export function documentGuestEmail(
  value: unknown,
) {
  const email =
    cleanText(
      value,
      320,
    )
      .toLowerCase()

  if (!email) {
    return ""
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(email)
      ? email
      : ""
}

export async function documentHmacSha256Hex(
  value: string,
  secret: string,
) {
  const encoder =
    new TextEncoder()

  const key =
    await crypto.subtle
      .importKey(
        "raw",
        encoder.encode(
          secret,
        ),
        {
          name:
            "HMAC",

          hash:
            "SHA-256",
        },
        false,
        [
          "sign",
        ],
      )

  const signature =
    await crypto.subtle
      .sign(
        "HMAC",
        key,
        encoder.encode(
          value,
        ),
      )

  return Array.from(
    new Uint8Array(
      signature,
    ),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("")
}

export function documentConstantTimeEqual(
  left: string,
  right: string,
) {
  if (
    left.length !==
    right.length
  ) {
    return false
  }

  let difference = 0

  for (
    let index = 0;
    index <
      left.length;
    index += 1
  ) {
    difference |=
      left.charCodeAt(
        index,
      ) ^
      right.charCodeAt(
        index,
      )
  }

  return difference === 0
}
