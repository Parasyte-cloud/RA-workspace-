import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/backupHealth.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const H = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

const NOW = Date.parse('2026-10-12T08:20:00Z')
const ago = ms => new Date(NOW - ms).toISOString()
const H1 = 3_600_000, D1 = 24 * H1
const sched = (over = {}) => ({ id: 'primary', enabled: true, frequency: 'daily', ...over })
const job = (over = {}) => ({
  status: 'succeeded', requested_at: ago(H1), completed_at: ago(H1), attempt_count: 1,
  restore_status: 'unverified', error_message: null, ...over,
})
const ids = issues => issues.map(i => i.id)

test('the real situation: schedule off, jobs stuck for weeks, two old failures', () => {
  const jobs = [
    job({ status: 'queued', requested_at: ago(3 * 60_000), completed_at: null, attempt_count: 0 }),
    job({ status: 'queued', requested_at: ago(24 * D1), completed_at: null, attempt_count: 0 }),
    job({ status: 'failed', requested_at: ago(41 * D1), attempt_count: 1, error_message: 'Backup runner stage failed: DATABASE AND AUTH BACKUP.' }),
    job({ status: 'failed', requested_at: ago(41 * D1 + H1), attempt_count: 1 }),
  ]
  const out = H.assessBackupHealth(sched({ enabled: false }), jobs, NOW)
  assert.deepEqual(ids(out), ['runner-offline', 'no-backup', 'last-failed', 'schedule-off'])
  assert.ok(out[0].detail.includes('24 days'))
  assert.equal(out[0].level, 'critical')
  assert.equal(out.at(-1).level, 'warning')
})

test('a job queued a few minutes ago is not an alarm', () => {
  const jobs = [job({ status: 'queued', requested_at: ago(3 * 60_000), attempt_count: 0 }), job()]
  assert.ok(!ids(H.assessBackupHealth(sched(), jobs, NOW)).includes('runner-offline'))
})

test('a queued job that has been tried is a failure to watch, not a dead runner', () => {
  const jobs = [job({ status: 'queued', requested_at: ago(5 * H1), attempt_count: 1 }), job()]
  assert.ok(!ids(H.assessBackupHealth(sched(), jobs, NOW)).includes('runner-offline'))
})

test('healthy and restore-tested means no banner', () => {
  const jobs = [job({ restore_status: 'verified' })]
  assert.deepEqual(H.assessBackupHealth(sched(), jobs, NOW), [])
})

test('good but never restore-tested is a warning only', () => {
  const out = H.assessBackupHealth(sched(), [job()], NOW)
  assert.deepEqual(ids(out), ['untested'])
  assert.equal(out[0].level, 'warning')
})

test('stale limits follow the schedule frequency', () => {
  const old = (days) => [job({ requested_at: ago(days * D1), completed_at: ago(days * D1), restore_status: 'verified' })]
  assert.deepEqual(ids(H.assessBackupHealth(sched(), old(1), NOW)), [])
  assert.deepEqual(ids(H.assessBackupHealth(sched(), old(2), NOW)), ['stale'])
  assert.deepEqual(ids(H.assessBackupHealth(sched({ frequency: 'weekly' }), old(8), NOW)), [])
  assert.deepEqual(ids(H.assessBackupHealth(sched({ frequency: 'weekly' }), old(9), NOW)), ['stale'])
  assert.deepEqual(ids(H.assessBackupHealth(sched({ frequency: 'monthly' }), old(31), NOW)), [])
  assert.deepEqual(ids(H.assessBackupHealth(sched({ frequency: 'monthly' }), old(33), NOW)), ['stale'])
})

test('staleness is not reported when the schedule is off (that has its own warning)', () => {
  const jobs = [job({ requested_at: ago(5 * D1), completed_at: ago(5 * D1), restore_status: 'verified' })]
  assert.deepEqual(ids(H.assessBackupHealth(sched({ enabled: false }), jobs, NOW)), ['schedule-off'])
})

test('no schedule row counts as off, and an empty history as no backup', () => {
  assert.deepEqual(ids(H.assessBackupHealth(null, [], NOW)), ['no-backup', 'schedule-off'])
})

test('a failure older than a later success is not reported as the latest', () => {
  const jobs = [
    job({ requested_at: ago(2 * H1), completed_at: ago(2 * H1), restore_status: 'verified' }),
    job({ status: 'failed', requested_at: ago(30 * H1) }),
  ]
  assert.deepEqual(H.assessBackupHealth(sched(), jobs, NOW), [])
})

test('the panel renders the banner from this module', () => {
  const panel = readFileSync('src/modules/AdminBackupsPanel.tsx', 'utf8')
  assert.match(panel, /assessBackupHealth\(schedule, jobs\)/)
  assert.match(panel, /adminBackupHealth/)
  assert.match(panel, /'Not set'/)
})
