// Intl.DateTimeFormat#format throws a RangeError for an invalid date. Several
// screens format timestamps straight from the database, so one bad row used to
// crash a whole section ("This workspace section could not be displayed").
// This wraps format() so a bad value renders as text instead of throwing.
export function installSafeIntlDate() {
  try {
    const proto = Intl.DateTimeFormat.prototype as unknown as object
    const desc = Object.getOwnPropertyDescriptor(proto, 'format')
    if (!desc?.get || (desc.get as { __ra?: boolean }).__ra) return
    const original = desc.get
    const wrapped = function (this: Intl.DateTimeFormat) {
      const fn = original.call(this) as (value?: Date | number) => string
      return (value?: Date | number) => {
        try { return fn(value) } catch (error) {
          if (error instanceof RangeError) return 'Unknown date'
          throw error
        }
      }
    }
    ;(wrapped as { __ra?: boolean }).__ra = true
    Object.defineProperty(proto, 'format', { configurable: true, enumerable: desc.enumerable, get: wrapped })
  } catch (_) { /* older engine: leave Intl alone */ }
}
installSafeIntlDate()
