// Who may issue invoices from the workspace. Finance and Operations raise them,
// the Administrator can do everything. Used by the navigation and the module.
export const INVOICE_ROLES = ['admin', 'finance', 'operations'] as const

export const canUseInvoice = (role: string | null | undefined): boolean =>
  INVOICE_ROLES.includes(String(role ?? '').toLowerCase() as (typeof INVOICE_ROLES)[number])
