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

    // showIf lets a field only apply (be shown / be required) when an
    // earlier field in the schema equals a given value, e.g. a "Which
    // state?" field that only matters when Area of Use is "Interstate".
    // It must reference a field defined earlier in the array (`seen`),
    // so evaluation never needs to look ahead.
    let showIf = null
    if (raw.showIf !== undefined && raw.showIf !== null) {
      if (!plainObject(raw.showIf) || !text(raw.showIf.field) || !text(raw.showIf.equals)) {
        return { ok: false, errors: [`Field ${key} has an invalid showIf condition.`] }
      }
      const conditionField = text(raw.showIf.field)
      if (!seen.has(conditionField)) {
        return { ok: false, errors: [`Field ${key}'s showIf condition references an unknown or later field.`] }
      }
      showIf = { field: conditionField, equals: text(raw.showIf.equals) }
    }

    // condLimits overrides a number/integer field's min/max based on
    // another field's current value, e.g. capping Number of Passengers
    // by the chosen vehicle. Rules are checked in order; the first
    // whose controlling field has a value present in its map wins.
    let condLimits = null
    if (raw.condLimits !== undefined && raw.condLimits !== null) {
      if (!Array.isArray(raw.condLimits)) {
        return { ok: false, errors: [`Field ${key} has an invalid condLimits.`] }
      }
      const rules = []
      for (const rawRule of raw.condLimits) {
        if (!plainObject(rawRule) || !text(rawRule.field) || !plainObject(rawRule.map)) {
          return { ok: false, errors: [`Field ${key} has an invalid condLimits rule.`] }
        }
        const ruleField = text(rawRule.field)
        if (!seen.has(ruleField)) {
          return { ok: false, errors: [`Field ${key}'s condLimits rule references an unknown or later field.`] }
        }
        const map = {}
        for (const [optionValue, limits] of Object.entries(rawRule.map)) {
          if (!plainObject(limits)) continue
          const entry = {}
          if (typeof limits.min === 'number' && Number.isFinite(limits.min)) entry.min = limits.min
          if (typeof limits.max === 'number' && Number.isFinite(limits.max)) entry.max = limits.max
          if (Object.keys(entry).length) map[optionValue] = entry
        }
        rules.push({ field: ruleField, map })
      }
      condLimits = rules
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
      showIf,
      condLimits,
    })
  }

  return { ok: true, fields }
}

function conditionMet(showIf, payload) {
  if (!showIf) return true
  const actual = payload[showIf.field]
  return typeof actual === 'string' && actual.trim() === showIf.equals
}

// Resolves the effective {min, max} for a number/integer field given the
// rest of the payload: the field's own static min/max, overridden by the
// first condLimits rule whose controlling field currently has a value
// present in that rule's map.
function effectiveLimits(field, payload) {
  let min = field.min
  let max = field.max

  for (const rule of field.condLimits || []) {
    const controllingValue = payload[rule.field]
    const key = typeof controllingValue === 'string' ? controllingValue.trim() : controllingValue
    if (key !== undefined && key !== null && Object.prototype.hasOwnProperty.call(rule.map, key)) {
      const entry = rule.map[key]
      if (entry.min !== undefined) min = min === null ? entry.min : Math.max(min, entry.min)
      if (entry.max !== undefined) max = max === null ? entry.max : Math.min(max, entry.max)
      break
    }
  }

  return { min, max }
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

    // A field with an unmet showIf condition was hidden from the person
    // filling out the form, so it's never required and whatever value
    // (if any) came through for it is dropped rather than validated.
    if (!conditionMet(field.showIf, rawPayload)) {
      continue
    }

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
      const { min, max } = effectiveLimits(field, rawPayload)
      if (min !== null && parsed < min) errors.push(`${field.label} is below the minimum.`)
      else if (max !== null && parsed > max) errors.push(`${field.label} is above the maximum.`)
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
      showIf: field.showIf || undefined,
      condLimits: field.condLimits || undefined,
    })),
  }
}
