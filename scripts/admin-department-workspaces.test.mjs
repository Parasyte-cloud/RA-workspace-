import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = path =>
  fs.existsSync(new URL(`../${path}`, import.meta.url))
    ? fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    : ''

const admin = read('src/modules/AdministrationControlPlane.tsx')
const recognition = read('src/modules/RecognitionCelebrationsAdmin.tsx')
const core = read('src/modules/CoreModules.tsx')
const app = read('src/App.tsx')
const departments = read('src/lib/adminDepartmentWorkspaces.ts')
const adminCss = read('src/admin-control-plane.css')
const recognitionCss = read('src/recognition-admin.css')

test('Administration exposes governed department workspace launchers', () => {
  assert.match(departments, /ADMIN_DEPARTMENT_WORKSPACES/)

  for (const section of [
    'support',
    'operations',
    'people',
    'engineering',
    'finance',
    'marketing',
    'partnerships',
    'legal',
    'executive',
  ]) {
    assert.match(
      departments,
      new RegExp(`section:\\s*['"]${section}['"]`),
      `${section} department workspace missing`,
    )
  }

  assert.match(admin, /AdminDepartmentWorkspaces/)
  assert.match(admin, /All Department Workspaces/i)
  assert.match(admin, /onNavigate/)
  assert.match(core, /AdministrationControlPlane[^>]*onNavigate/)
  assert.match(app, /AdminModule[^>]*onNavigate=\{navigateToSection\}/)
})

test('Administration Workstations keeps assignment controls and adds launchers', () => {
  const launcher = admin.indexOf('<AdminDepartmentWorkspaces')
  const assignments = admin.indexOf('<WorkstationAssignmentManager')

  assert.notEqual(launcher, -1, 'department workspace launcher is not mounted')
  assert.notEqual(assignments, -1, 'workstation assignment manager is missing')

  assert.ok(
    launcher < assignments,
    'department workspace launcher should appear before employee assignment controls',
  )
})

test('Recognition governance exposes a central Department Trophy Cabinets view', () => {
  assert.match(recognition, /DepartmentTrophyCabinet/)
  assert.match(recognition, /['"]cabinets['"]/)
  assert.match(recognition, /Trophy cabinets/i)
  assert.match(recognition, /selectedDepartment/)

  assert.match(
    recognition,
    /<DepartmentTrophyCabinet\s+department=\{selectedDepartment\}/,
  )

  assert.doesNotMatch(
    recognition,
    /\.from\(\s*['"]department_achievements['"]\s*\)/,
    'Administration must not bypass the governed trophy RPC boundary',
  )
})

test('new admin surfaces have responsive layout hooks', () => {
  assert.match(adminCss, /\.adminDepartmentWorkspaceLauncher/)
  assert.match(adminCss, /\.adminDepartmentWorkspaceGrid/)
  assert.match(recognitionCss, /\.recognitionAdminCabinetBrowser/)
})
