import { HttpError, MAX_FILE_BYTES, documentCategories, allowedMimeTypes, isPreviewableMime, cleanText, cleanNullableText, booleanField, integerField } from "./lib.ts"
import type { JsonObject } from "./lib.ts"

export function validateDocumentInput(
  body: JsonObject,
) {
  const title =
    cleanText(
      body.title,
      180,
    )

  if (
    title.length < 1
  ) {
    throw new HttpError(
      400,
      "Document title is required.",
    )
  }

  const description =
    cleanNullableText(
      body.description,
      2000,
    )

  const category =
    cleanText(
      body.category,
      40,
    )
      .toLowerCase() ||
    "general"

  if (
    !documentCategories.has(
      category,
    )
  ) {
    throw new HttpError(
      400,
      "Invalid ROOM 7 document category.",
    )
  }

  const originalFileName =
    cleanText(
      body.original_file_name,
      255,
    )

  if (
    !originalFileName ||
    originalFileName.includes(
      "/",
    ) ||
    originalFileName.includes(
      "\\",
    )
  ) {
    throw new HttpError(
      400,
      "Invalid document file name.",
    )
  }

  const mimeType =
    cleanText(
      body.mime_type,
      120,
    )
      .toLowerCase()

  if (
    !allowedMimeTypes.has(
      mimeType,
    )
  ) {
    throw new HttpError(
      415,
      "ROOM 7 supports PDF, JPEG, PNG, WebP, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text and CSV documents. Convert older .doc, .xls and .ppt files to PDF or the newer format first.",
    )
  }

  const fileSize =
    integerField(
      body.file_size_bytes,
      0,
    )

  if (
    fileSize < 1 ||
    fileSize >
      MAX_FILE_BYTES
  ) {
    throw new HttpError(
      400,
      "ROOM 7 documents must be between 1 byte and 25 MB.",
    )
  }

  const sortOrder =
    integerField(
      body.sort_order,
      0,
    )

  if (
    sortOrder < 0 ||
    sortOrder > 999
  ) {
    throw new HttpError(
      400,
      "Invalid document sort order.",
    )
  }

  const availableBefore =
    booleanField(
      body.available_before,
      true,
    )

  const availableDuring =
    booleanField(
      body.available_during,
      true,
    )

  const availableAfter =
    booleanField(
      body.available_after,
      true,
    )

  if (
    !availableBefore &&
    !availableDuring &&
    !availableAfter
  ) {
    throw new HttpError(
      400,
      "Published ROOM 7 documents need at least one visibility phase.",
    )
  }

  return {
    title,
    description,
    category,
    originalFileName,
    mimeType,
    fileSize,
    sortOrder,
    availableBefore,
    availableDuring,
    availableAfter,

    // Word, Excel, PowerPoint, text and CSV cannot be shown in the reader, so
    // downloading is the only way to open them and is always on.
    allowDownload:
      !isPreviewableMime(
        mimeType,
      ) ||
      booleanField(
        body.allow_download,
        false,
      ),
  }
}
