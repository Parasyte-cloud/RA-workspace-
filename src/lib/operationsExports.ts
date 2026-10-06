import { supabase } from './supabase'

// Talks to the ridearrivo-exports server function, which checks the person's
// Workspace role and fetches the CSV from the RideArrivo backend.

export type ExportDataset = {
  key: string
  label: string
  description: string
  adminOnly: boolean
}

export type ExportHistoryRow = {
  id: number
  user_email: string
  user_role: string
  dataset: string
  date_from: string | null
  date_to: string | null
  row_count: number | null
  status: string
  source: string
  time_wat: string
}

async function call(body: Record<string, string>): Promise<Response> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) {
    throw new Error('Your session has expired. Sign in again.')
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ridearrivo-exports`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    },
  )

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail?.error || `The request failed (${response.status}).`)
  }
  return response
}

export async function listExports(): Promise<{ datasets: ExportDataset[]; maxRows: number }> {
  return (await call({ action: 'list' })).json()
}

export async function exportHistory(): Promise<ExportHistoryRow[]> {
  const result = await (await call({ action: 'history' })).json()
  return result.history || []
}

// Downloads one dataset and hands the file to the browser. Returns the file
// name and the number of rows the backend reported.
export async function downloadExport(
  dataset: string,
  range: { from: string; to: string },
): Promise<{ filename: string; rows: number | null }> {
  const response = await call({
    action: 'download',
    dataset,
    from: range.from,
    to: range.to,
  })

  const disposition = response.headers.get('Content-Disposition') || ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = match ? match[1] : `arrivo-${dataset}.csv`
  const rowsHeader = response.headers.get('X-Row-Count')
  const rows = rowsHeader === null ? null : Number(rowsHeader)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)

  return { filename, rows: Number.isFinite(rows) ? rows : null }
}
