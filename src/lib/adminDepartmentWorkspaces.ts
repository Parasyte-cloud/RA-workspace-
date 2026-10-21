export type AdminDepartmentWorkspace = {
  section: string
  label: string
  department: string
  description: string
}

export const ADMIN_DEPARTMENT_WORKSPACES: readonly AdminDepartmentWorkspace[] = [
  {
    section: 'support',
    label: 'Support',
    department: 'Support',
    description: 'Customer assistance, cases, ticketing and service recovery.',
  },
  {
    section: 'operations',
    label: 'Operations',
    department: 'Operations',
    description: 'Dispatch, fleet, drivers, incidents and live service control.',
  },
  {
    section: 'people',
    label: 'People & HR',
    department: 'People & HR',
    description: 'People operations, onboarding, attendance and employee services.',
  },
  {
    section: 'engineering',
    label: 'Engineering',
    department: 'Engineering',
    description: 'Product engineering, infrastructure, releases and security.',
  },
  {
    section: 'finance',
    label: 'Finance',
    department: 'Finance',
    description: 'Banking, payments, budgets, receivables and financial control.',
  },
  {
    section: 'marketing',
    label: 'Marketing',
    department: 'Marketing',
    description: 'Growth, campaigns, content and marketing intelligence.',
  },
  {
    section: 'partnerships',
    label: 'Partnerships',
    department: 'Partnerships',
    description: 'Commercial partnerships, onboarding and relationship management.',
  },
  {
    section: 'legal',
    label: 'Legal & Compliance',
    department: 'Legal',
    description: 'Contracts, privacy, compliance and regulatory operations.',
  },
  {
    section: 'executive',
    label: 'Executive & Management',
    department: 'Management',
    description: 'Company leadership, priorities, decisions and enterprise risk.',
  },
] as const
