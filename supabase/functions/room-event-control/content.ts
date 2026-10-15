import { HttpError, cleanText } from "./lib.ts"

export function room7ControlUuid(
  value: unknown,
  label: string,
) {
  const id =
    cleanText(
      value,
      64,
    )

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(id)
  ) {
    throw new HttpError(
      400,
      `${label} is invalid.`,
    )
  }

  return id
}

export function room7OptionalContentText(
  value: unknown,
  max: number,
  label: string,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  if (
    typeof value !==
      "string"
  ) {
    throw new HttpError(
      400,
      `${label} must be text or null.`,
    )
  }

  const cleaned =
    value.trim()

  if (!cleaned) {
    return null
  }

  if (
    cleaned.length >
      max
  ) {
    throw new HttpError(
      400,
      `${label} cannot exceed ${max} characters.`,
    )
  }

  return cleaned
}

export function room7StoryPoints(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "Story points must be an array.",
    )
  }

  if (value.length > 6) {
    throw new HttpError(
      400,
      "ROOM 7 supports up to six Story points.",
    )
  }

  return value.map(
    (
      item: any,
      index: number,
    ) => {
      if (
        !item ||
        typeof item !==
          "object" ||
        Array.isArray(item)
      ) {
        throw new HttpError(
          400,
          `Story point ${index + 1} is invalid.`,
        )
      }

      const title =
        cleanText(
          item.title,
          80,
        )

      if (!title) {
        throw new HttpError(
          400,
          `Story point ${index + 1} requires a title.`,
        )
      }

      return {
        title,

        description:
          room7OptionalContentText(
            item.description,
            500,
            `Story point ${index + 1} description`,
          ),
      }
    },
  )
}

export function room7ProgrammeItems(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "Programme items must be an array.",
    )
  }

  if (value.length > 12) {
    throw new HttpError(
      400,
      "ROOM 7 supports up to twelve programme items.",
    )
  }

  return value.map(
    (
      item: any,
      index: number,
    ) => {
      if (
        !item ||
        typeof item !==
          "object" ||
        Array.isArray(item)
      ) {
        throw new HttpError(
          400,
          `Programme item ${index + 1} is invalid.`,
        )
      }

      const title =
        cleanText(
          item.title,
          180,
        )

      if (!title) {
        throw new HttpError(
          400,
          `Programme item ${index + 1} requires a title.`,
        )
      }

      return {
        title,

        description:
          room7OptionalContentText(
            item.description,
            1000,
            `Programme item ${index + 1} description`,
          ),

        time_label:
          room7OptionalContentText(
            item.time_label,
            80,
            `Programme item ${index + 1} time`,
          ),
      }
    },
  )
}
