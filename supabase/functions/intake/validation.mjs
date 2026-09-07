export const MAX_BODY_BYTES = 64 * 1024
export const MAX_FIELDS = 64

const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'phone',
  'number',
  'integer',
  'select',
  'multiselect',
  'checkbox',
  'date',
  'url',
])

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePhone(value) {
  const raw = text(value)
  if (!raw) return null

  const compact = raw.replace(/[\s().-]/g, '')
  if (!/^\+?\d+$/.test(compact)) return null

  if (/^0\d{10}$/.test(compact)) {
    return `+234${compact.slice(1)}`
  }

  if (/^234\d{10}$/.test(compact)) {
    return `+${compact}`
  }

  const normalized = compact.startsWith('+') ? compact : `+${compact}`
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null
  return normalized
}

export function normalizeSchema(rawSchema) {
  if (!plainObject(rawSchema) || !Array.isArray(rawSchema.fields)) {
    return { ok: false, errors: ['Form schema is invalid.'] }
  }

  if (rawSchema.fields.length > MAX_FIELDS) {
    return { ok: false, errors: [`Form schema exceeds ${MAX_FIELDS} fields.`] }
  }

  const fields = []
  const seen = new Set()

  for (let i = 0; i < rawSchema.fields.length; i += 1) {
    const raw = rawSchema.fields[i]
    if (!plainObject(raw)) {
      return { ok: false, errors: [`Field ${i + 1} is invalid.`] }
    }

    const key = text(raw.key)
    const label = text(raw.label) || key
    const type = text(raw.type).toLowerCase()

    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      return { ok: false, errors: [`Field ${i + 1} has an invalid key.`] }
    }

    if (seen.has(key)) {
      return { ok: false, errors: [`Duplicate field key: ${key}.`] }
    }
    seen.add(key)

    if (!FIELD_TYPES.has(type)) {
      return { ok: false, errors: [`Unsupported field type for ${key}.`] }
    }

    const options = Array.isArray(raw.options)
      ? raw.options
          .map((item) => text(plainObject(item) ? item.value : item))
          .filter(Boolean)
          .slice(0, 100)
      : []

    if ((type === 'select' || type === 'multiselect') && options.length === 0) {
      return { ok: false, errors: [`Field ${key} requires options.`] }
    }

    fields.push({
      key,
      label: label.slice(0, 160),
      type,
      required: raw.required === true,
      minLength: boundedInteger(raw.minLength, 0, 0, 10000),
      maxLength: boundedInteger(
        raw.maxLength,
        type === 'textarea' ? 5000 : 500,
        1,
        10000,
      ),
      min: typeof raw.min === 'number' && Number.isFinite(raw.min) ? raw.min : null,
      max: typeof raw.max === 'number' && Number.isFinite(raw.max) ? raw.max : null,
      options,
      placeholder: text(raw.placeholder).slice(0, 200),
      helpText: text(raw.helpText).slice(0, 500),
    })
  }

  return { ok: true, fields }
}

function missing(value, type) {
  if (type === 'multiselect') return !Array.isArray(value) || value.length === 0
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
}

function validateString(field, value, errors) {
  if (typeof value !== 'string') {
    errors.push(`${field.label} must be text.`)
    return null
  }

  const valueText = value.trim()
  if (valueText.length < field.minLength || valueText.length > field.maxLength) {
    errors.push(`${field.label} must contain ${field.minLength} to ${field.maxLength} characters.`)
    return null
  }
  return valueText
}

export function validateSubmission(rawSchema, rawPayload) {
  const schema = normalizeSchema(rawSchema)
  if (!schema.ok) return schema

  if (!plainObject(rawPayload)) {
    return { ok: false, errors: ['Submission payload must be an object.'] }
  }

  const allowed = new Set(schema.fields.map((field) => field.key))
  const unknown = Object.keys(rawPayload).filter((key) => !allowed.has(key))
  if (unknown.length) {
    return { ok: false, errors: [`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`] }
  }

  const errors = []
  const value = {}

  for (const field of schema.fields) {
    const raw = rawPayload[field.key]

    if (field.type === 'checkbox') {
      if (raw === null || raw === undefined) {
        if (field.required) errors.push(`${field.label} is required.`)
      } else if (typeof raw !== 'boolean') {
        errors.push(`${field.label} must be true or false.`)
      } else if (field.required && raw !== true) {
        errors.push(`${field.label} is required.`)
      } else {
        value[field.key] = raw
      }
      continue
    }

    if (missing(raw, field.type)) {
      if (field.required) errors.push(`${field.label} is required.`)
      continue
    }

    if (field.type === 'number' || field.type === 'integer') {
      const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(parsed) || (field.type === 'integer' && !Number.isInteger(parsed))) {
        errors.push(`${field.label} must be a valid ${field.type}.`)
        continue
      }
      if (field.min !== null && parsed < field.min) errors.push(`${field.label} is below the minimum.`)
      else if (field.max !== null && parsed > field.max) errors.push(`${field.label} is above the maximum.`)
      else value[field.key] = parsed
      continue
    }

    if (field.type === 'multiselect') {
      if (!Array.isArray(raw) || raw.length > 50) {
        errors.push(`${field.label} must be a valid selection list.`)
        continue
      }
      const selected = [...new Set(raw.map((item) => text(item)).filter(Boolean))]
      if (selected.some((item) => !field.options.includes(item))) {
        errors.push(`${field.label} contains an invalid option.`)
      } else {
        value[field.key] = selected
      }
      continue
    }

    const stringValue = validateString(field, raw, errors)
    if (stringValue === null) continue

    if (field.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue) || stringValue.length > 254) {
        errors.push(`${field.label} must be a valid email address.`)
      } else {
        value[field.key] = stringValue.toLowerCase()
      }
      continue
    }

    if (field.type === 'phone') {
      const phone = normalizePhone(stringValue)
      if (!phone) errors.push(`${field.label} must be a valid phone number.`)
      else value[field.key] = phone
      continue
    }

    if (field.type === 'select') {
      if (!field.options.includes(stringValue)) errors.push(`${field.label} contains an invalid option.`)
      else value[field.key] = stringValue
      continue
    }

    if (field.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue) || Number.isNaN(Date.parse(`${stringValue}T00:00:00Z`))) {
        errors.push(`${field.label} must be a valid date.`)
      } else {
        value[field.key] = stringValue
      }
      continue
    }

    if (field.type === 'url') {
      try {
        const url = new URL(stringValue)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
        value[field.key] = url.toString()
      } catch {
        errors.push(`${field.label} must be a valid HTTP or HTTPS URL.`)
      }
      continue
    }

    value[field.key] = stringValue
  }

  return errors.length ? { ok: false, errors } : { ok: true, value }
}

export function clientSchema(rawSchema) {
  const normalized = normalizeSchema(rawSchema)
  if (!normalized.ok) return normalized

  return {
    ok: true,
    fields: normalized.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      minLength: field.minLength || undefined,
      maxLength: field.maxLength,
      min: field.min ?? undefined,
      max: field.max ?? undefined,
      options: field.options.length ? field.options : undefined,
      placeholder: field.placeholder || undefined,
      helpText: field.helpText || undefined,
    })),
  }
}
