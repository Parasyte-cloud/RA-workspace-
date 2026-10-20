import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const cabinet = read('src/components/DepartmentTrophyCabinet.tsx')
const workspace = read('src/modules/DepartmentTeamWorkspace.tsx')
const css = read('src/department-achievements.css') + '\n' + read('src/department-workspace.css')

function indexOrFail(text, token) {
  const index = text.indexOf(token)
  assert.notEqual(index, -1, `${token} missing`)
  return index
}

test('cabinet is mounted after the department hero and before department tabs', () => {
  const hero = indexOrFail(workspace, '<div className="departmentHero">')
  const shelf = indexOrFail(workspace, '<DepartmentTrophyCabinet')
  const tabs = indexOrFail(workspace, '<div className="departmentTabs">')
  assert.ok(hero < shelf && shelf < tabs, 'trophy cabinet must be between hero and tabs')
})

test('cabinet owns server authorization and never reads protected tables directly', () => {
  assert.match(cabinet, /get_authorized_department_trophy_context/)
  assert.match(cabinet, /list_department_trophy_history/)
  assert.doesNotMatch(cabinet, /\.from\(\s*['"]department_achievements['"]\s*\)/)
  assert.doesNotMatch(cabinet, /enabled\s*:/)
})

test('cabinet has authorized empty, denied, loading, retry and populated states', () => {
  assert.match(cabinet, /This department has room for its first trophy\./)
  assert.match(cabinet, /Complete a qualifying achievement to begin the collection\./)
  assert.match(cabinet, /You do not have access to this department trophy cabinet\./)
  assert.match(cabinet, /Loading department trophies/)
  assert.match(cabinet, /Retry/)
  assert.match(cabinet, /departmentTrophyCount/)
  assert.match(cabinet, /departmentTrophyFeatured/)
  assert.match(cabinet, /departmentTrophyShelf/)
})

test('cabinet suppresses stale requests and uses realtime only as a refetch signal', () => {
  assert.match(cabinet, /requestSequenceRef/)
  assert.match(cabinet, /requestSequence\s*!==\s*requestSequenceRef\.current/)
  assert.match(cabinet, /table:\s*['"]department_achievements['"]/)
  assert.match(cabinet, /setTimeout/)
  assert.match(cabinet, /load\(false\)/)
  assert.match(cabinet, /removeChannel/)
  assert.match(cabinet, /setInterval/, 'cabinet must periodically refetch because protected tables are not directly selectable by browsers')
  assert.match(cabinet, /visibilitychange/)
  assert.match(cabinet, /window\.addEventListener\(['"]focus['"]/)
})

test('mobile cabinet preserves a visible horizontally scrollable shelf', () => {
  assert.match(css, /departmentTrophyShelf/)
  assert.match(css, /overflow-x:\s*auto/)
  assert.doesNotMatch(css, /@media[^}]+\{[^}]*departmentTrophyCabinet[^}]*display:\s*none/s)
})
