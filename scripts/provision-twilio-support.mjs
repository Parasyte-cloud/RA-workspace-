#!/usr/bin/env node
// Provision the Twilio side of the RA Support Command Centre.
//
//   node scripts/provision-twilio-support.mjs --functions-url https://<ref>.supabase.co/functions/v1            (dry run)
//   node scripts/provision-twilio-support.mjs --functions-url https://<ref>.supabase.co/functions/v1 --apply
//
// Reads TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN from the environment only.
// Safe to re-run: every object is found by name and updated, never duplicated.
//
// Creates / updates
//   TaskRouter workspace "RA Support" with activities Available, Busy, WrapUp, Break, Offline
//   four queues (general, safety, active ride, payments) and the routing workflow
//   assignment + event callbacks that point at the support Edge Functions
//   a TwiML App for the browser softphone
//   optionally an API key for Voice access tokens (--create-api-key)
//
// Secrets (the API key secret) are written only to the 0600 file given by --out,
// never printed. Load that file with:  supabase secrets set --env-file <file>
//
// PArAsYtE | RA-Workspace support module

import { writeFileSync, existsSync, chmodSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  ACTIVITY_DEFINITIONS,
  QUEUE_DEFINITIONS,
  buildWorkflowConfiguration,
} from '../supabase/functions/_shared/supportCore.ts'

export const WORKSPACE_NAME = 'RA Support'
export const WORKFLOW_NAME = 'RA Support Routing'
export const TWIML_APP_NAME = 'RA Support Softphone'
export const API_KEY_NAME = 'RA Support Voice Tokens'
export const EVENTS_FILTER = [
  'reservation.accepted', 'reservation.rejected', 'reservation.timeout', 'reservation.completed',
  'task.canceled', 'task.deleted', 'task.completed',
].join(',')

export function desiredState(functionsUrl) {
  const base = functionsUrl.replace(/\/+$/, '')
  return {
    workspace: { FriendlyName: WORKSPACE_NAME, EventCallbackUrl: `${base}/support-taskrouter-webhook?action=event`, EventsFilter: EVENTS_FILTER },
    activities: ACTIVITY_DEFINITIONS,
    queues: QUEUE_DEFINITIONS,
    workflow: {
      FriendlyName: WORKFLOW_NAME,
      AssignmentCallbackUrl: `${base}/support-taskrouter-webhook?action=assignment`,
      FallbackAssignmentCallbackUrl: `${base}/support-taskrouter-webhook?action=assignment`,
      // 25s matches the browser ring time; longer just keeps the customer on a dead ring.
      TaskReservationTimeout: 25,
    },
    twimlApp: { FriendlyName: TWIML_APP_NAME, VoiceUrl: `${base}/support-voice-webhook?action=outbound`, VoiceMethod: 'POST' },
  }
}

function parseArgs(argv) {
  const out = { apply: false, createApiKey: false, out: '.env.support.generated', functionsUrl: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') out.apply = true
    else if (a === '--create-api-key') out.createApiKey = true
    else if (a === '--functions-url') out.functionsUrl = argv[++i] || ''
    else if (a === '--out') out.out = argv[++i] || out.out
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return out
}

function client(accountSid, authToken) {
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  return async (method, url, form) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    if (!res.ok) throw new Error(`${method} ${url.replace(accountSid, 'AC***')} failed (${res.status}): ${json?.message || text.slice(0, 200)}`)
    return json
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.functionsUrl) {
    console.log('Usage: node scripts/provision-twilio-support.mjs --functions-url https://<project-ref>.supabase.co/functions/v1 [--apply] [--create-api-key] [--out file]')
    process.exit(args.help ? 0 : 2)
  }
  if (!/^https:\/\//.test(args.functionsUrl)) throw new Error('--functions-url must be https')
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) throw new Error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in the environment.')

  const want = desiredState(args.functionsUrl)
  const call = client(accountSid, authToken)
  const TR = 'https://taskrouter.twilio.com/v1'
  const say = (m) => console.log(args.apply ? m : `[dry run] would ${m}`)
  const env = {}

  // Reads always run, even in a dry run, so the plan reflects what exists.
  const found = await call('GET', `${TR}/Workspaces?FriendlyName=${encodeURIComponent(WORKSPACE_NAME)}`)
  let ws = (found.workspaces || []).find((w) => w.friendly_name === WORKSPACE_NAME) || null
  if (!ws) {
    say(`create workspace "${WORKSPACE_NAME}"`)
    if (!args.apply) return console.log('Dry run stops here: nothing else can be planned without a workspace. Re-run with --apply.')
    ws = await call('POST', `${TR}/Workspaces`, want.workspace)
  } else {
    say(`update workspace ${ws.sid} callbacks`)
    if (args.apply) ws = await call('POST', `${TR}/Workspaces/${ws.sid}`, want.workspace)
  }
  const W = `${TR}/Workspaces/${ws.sid}`
  env.TWILIO_TASKROUTER_WORKSPACE_SID = ws.sid

  // Activities
  const have = (await call('GET', `${W}/Activities?PageSize=50`)).activities || []
  const sidByKey = {}
  for (const def of want.activities) {
    let a = have.find((x) => x.friendly_name.toLowerCase() === def.name.toLowerCase())
    if (!a) {
      say(`create activity ${def.name}`)
      if (args.apply) a = await call('POST', `${W}/Activities`, { FriendlyName: def.name, Available: def.available })
    } else if (a.available !== def.available) {
      console.warn(`WARNING: activity "${a.friendly_name}" exists with available=${a.available}, expected ${def.available}. Twilio does not allow changing it; fix by hand.`)
    }
    if (a) sidByKey[def.key] = a.sid
  }
  const envKey = { available: 'AVAILABLE', busy: 'BUSY', wrapup: 'WRAPUP', break: 'BREAK', offline: 'OFFLINE' }
  for (const [k, sid] of Object.entries(sidByKey)) env[`TWILIO_TASKROUTER_${envKey[k]}_ACTIVITY_SID`] = sid
  // A reservation that times out drops the officer to Offline, so one missed call is not ten.
  if (args.apply && sidByKey.offline) {
    await call('POST', `${W}`, { DefaultActivitySid: sidByKey.offline, TimeoutActivitySid: sidByKey.offline })
  } else if (!args.apply) say('set workspace default and timeout activity to Offline')

  // Queues
  const haveQ = (await call('GET', `${W}/TaskQueues?PageSize=50`)).task_queues || []
  const queueSid = {}
  for (const def of want.queues) {
    let q = haveQ.find((x) => x.friendly_name === def.name)
    const form = { FriendlyName: def.name, TargetWorkers: def.targetWorkers, MaxReservedWorkers: 1, AssignmentActivitySid: sidByKey.busy, ReservationActivitySid: undefined }
    if (!q) { say(`create queue ${def.name}`); if (args.apply) q = await call('POST', `${W}/TaskQueues`, form) }
    else { say(`update queue ${def.name}`); if (args.apply) q = await call('POST', `${W}/TaskQueues/${q.sid}`, form) }
    if (q) queueSid[def.key] = q.sid
  }

  // Workflow
  if (args.apply) {
    const config = JSON.stringify(buildWorkflowConfiguration(queueSid))
    const haveW = (await call('GET', `${W}/Workflows?PageSize=50`)).workflows || []
    let wf = haveW.find((x) => x.friendly_name === WORKFLOW_NAME)
    const form = { ...want.workflow, Configuration: config }
    wf = wf ? await call('POST', `${W}/Workflows/${wf.sid}`, form) : await call('POST', `${W}/Workflows`, form)
    env.TWILIO_TASKROUTER_WORKFLOW_SID = wf.sid
  } else { say(`create or update workflow "${WORKFLOW_NAME}"`) }

  // TwiML App for the softphone
  const A = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`
  const apps = (await call('GET', `${A}/Applications.json?FriendlyName=${encodeURIComponent(TWIML_APP_NAME)}`)).applications || []
  let app = apps[0] || null
  say(`${app ? 'update' : 'create'} TwiML App "${TWIML_APP_NAME}"`)
  if (args.apply) app = app ? await call('POST', `${A}/Applications/${app.sid}.json`, want.twimlApp) : await call('POST', `${A}/Applications.json`, want.twimlApp)
  if (app) env.TWILIO_TWIML_APP_SID = app.sid

  // API key (secret only ever goes to the 0600 file)
  let secretLine = ''
  if (args.createApiKey) {
    say(`create API key "${API_KEY_NAME}"`)
    if (args.apply) {
      const key = await call('POST', `${A}/Keys.json`, { FriendlyName: API_KEY_NAME })
      env.TWILIO_API_KEY_SID = key.sid
      secretLine = `TWILIO_API_KEY_SECRET=${key.secret}\n`
    }
  }

  if (args.apply) {
    env.TWILIO_ACCOUNT_SID = accountSid
    const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n' + secretLine
    const existed = existsSync(args.out)
    writeFileSync(args.out, body, { mode: 0o600 })
    chmodSync(args.out, 0o600)
    console.log(`\nWrote ${args.out}${existed ? ' (overwritten)' : ''}, mode 600. Contains SIDs${secretLine ? ' and the new API key secret' : ''}. It is not printed here.`)
    console.log('Next:')
    console.log(`  1. supabase secrets set --env-file ${args.out}   (also set TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, SUPPORT_CRON_SECRET, SUPPORT_INGEST_SECRET yourself)`)
    console.log('  2. Point your Twilio number\'s voice webhook at ' + `${args.functionsUrl.replace(/\/+$/, '')}/support-voice-webhook?action=inbound`)
    console.log(`  3. Delete ${args.out} once the secrets are set, and never commit it.`)
    if (!secretLine) console.log('  Note: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET were not created. Re-run with --create-api-key, or create a Standard key in the Twilio console.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1) })
}
