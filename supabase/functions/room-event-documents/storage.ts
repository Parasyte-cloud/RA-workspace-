export function signedStoragePath(
  value: string,
) {
  let parsed: URL

  try {
    parsed =
      new URL(
        value,
        "https://room7.invalid",
      )
  } catch {
    throw new Error(
      "Storage returned an invalid signed document reference.",
    )
  }

  if (
    !parsed.pathname
      .startsWith(
        "/storage/v1/object/",
      )
  ) {
    throw new Error(
      "Storage returned an unexpected signed document path.",
    )
  }

  return (
    parsed.pathname +
    parsed.search
  )
}
