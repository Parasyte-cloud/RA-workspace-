import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => {
  assert.ok(existsSync(path), `${path} must exist`)
  return readFileSync(path, 'utf8')
}

const responsive = read('src/responsive.css')
const personalCss = read('src/personal-dashboard.css')
const workflowCss = read('src/workflow.css')

const task2Files = [
  'src/modules/PersonalDashboard.tsx',
  'src/modules/DepartmentTeamWorkspace.tsx',
  'src/modules/MarketingTeamWorkspace.tsx',
  'src/modules/SharedWorkspacesHub.tsx',
]

const task3Files = [
  'src/modules/FinanceBanking.tsx',
  'src/modules/DepartmentAdminView.tsx',
  'src/modules/AdminAccessManager.tsx',
  'src/modules/ApplicationsHub.tsx',
  'src/modules/CoreModules.tsx',
  'src/modules/BusinessModules.tsx',
  'src/modules/Phase2Modules.tsx',
  'src/modules/ProfileModule.tsx',
  'src/modules/MailModule.tsx',
  'src/modules/SocialModule.tsx',
  'src/modules/SupportOperationsPanel.tsx',
  'src/modules/SharedWorkspacesHub.tsx',
  'src/modules/DataWorkbench.tsx',
  'src/components/EmployeeVirtualCard.tsx',
  'src/modules/BrandLibrary.tsx',
]

const allFiles = [...new Set([...task2Files, ...task3Files])]
const sources = Object.fromEntries(allFiles.map(path => [path, read(path)]))

function assertNoLocalHeavyGlass(path) {
  assert.doesNotMatch(
    sources[path],
    /backdrop-filter\s*:/i,
    `${path} must consume shared glass primitives instead of defining blur`,
  )
}

test('core migration files are present and keep glass blur centralized', () => {
  for (const path of allFiles) assertNoLocalHeavyGlass(path)
  assert.doesNotMatch(
    [personalCss, workflowCss].join('\n'),
    /backdrop-filter\s*:/i,
    'module-specific CSS must not define heavy glass blur',
  )
})

test('dashboard and workstation roots opt into shared responsive surfaces', () => {
  assert.match(sources['src/modules/PersonalDashboard.tsx'], /personalDashboard todayView responsiveModule responsiveDashboard/)
  assert.match(sources['src/modules/DepartmentTeamWorkspace.tsx'], /departmentWorkspace responsiveModule responsiveWorkbench/)
  assert.match(sources['src/modules/MarketingTeamWorkspace.tsx'], /responsiveModule responsiveWorkbench/)
  assert.match(sources['src/modules/SharedWorkspacesHub.tsx'], /sharedHub[^`"']*responsiveModule responsiveWorkbench/)
  assert.match(responsive, /\.responsiveModule\s*\{/)
  assert.match(responsive, /\.responsiveDashboard/)
  assert.match(responsive, /\.responsiveWorkbench/)
})

test('compact core controls remain iOS zoom safe and shared states stay readable', () => {
  assert.match(
    responsive,
    /@media\s*\(max-width:\s*599px\)[\s\S]*input,[\s\S]*textarea,[\s\S]*select\s*\{[\s\S]*font-size:\s*16px\s*!important/s,
  )
  assert.match(responsive, /\.responsiveState/)
  assert.match(responsive, /\.responsiveToolbar/)
  assert.match(responsive, /\.responsiveActionBar/)
})

test('migrated work surfaces avoid page-owned 100vh and oversized compact minimums', () => {
  for (const [path, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /(?:height|min-height)\s*:\s*100vh/i, `${path} must leave viewport ownership to the shell`)
    assert.doesNotMatch(source, /min-width\s*:\s*(?:[6-9]\d\d|[1-9]\d{3,})px/i, `${path} must not force a compact-hostile minimum width`)
  }
})

test('admin finance data and application surfaces opt into shared responsive module semantics', () => {
  for (const path of [
    'src/modules/FinanceBanking.tsx',
    'src/modules/DepartmentAdminView.tsx',
    'src/modules/AdminAccessManager.tsx',
    'src/modules/ApplicationsHub.tsx',
    'src/modules/ProfileModule.tsx',
    'src/modules/MailModule.tsx',
    'src/modules/SocialModule.tsx',
    'src/modules/SupportOperationsPanel.tsx',
    'src/modules/DataWorkbench.tsx',
    'src/modules/BrandLibrary.tsx',
  ]) {
    assert.match(sources[path], /responsiveModule/, `${path} must use the shared responsive module marker`)
  }
})

test('wide data surfaces use local scrolling instead of page overflow', () => {
  assert.match(sources['src/modules/DataWorkbench.tsx'], /responsiveTableScroller/)
  assert.match(sources['src/modules/FinanceBanking.tsx'], /responsiveTableScroller/)
  assert.match(sources['src/modules/DepartmentAdminView.tsx'], /responsiveTableScroller/)
  assert.match(responsive, /\.responsiveTableScroller\s*\{/)
  assert.match(responsive, /overflow-x:\s*auto/)
  assert.match(responsive, /overscroll-behavior-inline:\s*contain/)
})

test('forms record lists and modal sheets expose shared compact presentation hooks', () => {
  assert.match(responsive, /\.responsiveFormGrid/)
  assert.match(responsive, /\.responsiveRecordList/)
  assert.match(responsive, /\.responsiveModalSheet/)
  assert.match(sources['src/components/EmployeeVirtualCard.tsx'], /virtualCardModal[^"']*glassSheet[^"']*responsiveModalSheet/)
  assert.match(sources['src/modules/ProfileModule.tsx'], /responsiveFormGrid/)
  assert.match(sources['src/modules/Phase2Modules.tsx'], /responsiveModalSheet/)
})
