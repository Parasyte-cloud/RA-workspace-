import { createContext, useContext } from 'react'

/*
 * Operations supervisors and support supervisors see the Operations centre
 * read only. The database is the real gate (select-only policies); this
 * context only hides the add and edit controls so nobody is offered an action
 * that would be refused.
 *
 * PArAsYtE
 */
export const OperationsReadOnlyContext = createContext(false)

export const useOperationsReadOnly = () => useContext(OperationsReadOnlyContext)
