import fs from 'node:fs'

const ui =
  fs.readFileSync(
    'src/modules/AdminAccessManager.tsx',
    'utf8'
  )

const edge =
  fs.readFileSync(
    'supabase/functions/workspace-user-admin/index.ts',
    'utf8'
  )

let passed=0
let failed=0

function check(name,condition){
  if(condition){
    console.log(`PASS: ${name}`)
    passed+=1
  }else{
    console.log(`FAIL: ${name}`)
    failed+=1
  }
}

console.log(
  'Reporting manager directory contract:'
)

check(
  'all other employee accounts are eligible for directory display',
  ui.includes(
    'candidate.id!==user.id'
  )
)

check(
  'directory no longer restricts candidates to manager/admin role',
  !ui.includes(
    "['manager','admin'].includes(candidate.role)"
  )
)

check(
  'inactive or pending people remain visible but disabled',
  ui.includes(
    'disabled={!candidate.active}'
  )
)

check(
  'candidate status is shown',
  ui.includes(
    "'Pending / inactive'"
  ) &&
  ui.includes(
    "'Active'"
  )
)

check(
  'candidate department is shown',
  ui.includes(
    "candidate.department || 'Unassigned'"
  )
)

check(
  'candidate job title or role is shown',
  ui.includes(
    'candidate.job_title || candidate.role'
  )
)

check(
  'UI explains reporting role does not grant global Manager role',
  ui.includes(
    'does not automatically'
  ) &&
  ui.includes(
    'company-wide Manager role'
  )
)

check(
  'server rejects self-management',
  edge.includes(
    'managerId===userId'
  ) &&
  edge.includes(
    'cannot be their own manager'
  )
)

check(
  'server requires selected reporting manager to exist',
  edge.includes(
    'Selected reporting manager was not found.'
  )
)

check(
  'server requires active reporting manager access',
  edge.includes(
    'Selected reporting manager must have active workspace access.'
  )
)

check(
  'server no longer requires manager/admin role for reporting relationship',
  !edge.includes(
    'Selected manager must be an active Manager or Admin.'
  )
)

check(
  'server walks reporting hierarchy',
  edge.includes(
    'hierarchyCursor'
  ) &&
  edge.includes(
    'visitedManagerIds'
  )
)

check(
  'server rejects reporting cycles',
  edge.includes(
    'would create a management cycle'
  ) &&
  edge.includes(
    'existing reporting hierarchy contains a cycle'
  )
)

check(
  'manager id remains part of audited employee update',
  edge.includes(
    'metadata:{role,department,job_title:jobTitle,manager_id:managerId}'
  )
)

console.log(
  `REPORTING_MANAGER_DIRECTORY_PASS=${passed}`
)

console.log(
  `REPORTING_MANAGER_DIRECTORY_FAIL=${failed}`
)

if(failed>0){
  process.exitCode=1
}
