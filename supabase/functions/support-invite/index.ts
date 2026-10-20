// Staff invites for the Support team.
//
// Signed-in administrators (and supervisors an administrator delegated):
//   POST { action: 'create',   email, fullName, phone?, roleKind?, jobTitle?, channels?: ['email','whatsapp'] }
//   POST { action: 'resend',   inviteId, channels? }      (issues a NEW code; the old one dies)
//   POST { action: 'revoke',   inviteId }
//   POST { action: 'delegate', employeeId, value }        (administrators only)
//   The clear code is returned once so the admin can hand it over by phone or in person.
//   Listing is a direct RPC from the browser (support_invites_list).
//
// The person being invited (no account yet, no session):
//   POST { action: 'redeem', email, code, password }
//   Verifies the code, creates the sign-in, grants Support access only.
//
// verify_jwt is false because redeem has no session. Every other action checks the
// caller's session itself, and the database re-checks who may invite.
//
// PArAsYtE | RA-Workspace support module

import { generateInviteCode, inviteMessage, isValidEmail, normalizeInviteCode, normalizePhone, validateJoinPassword } from '../_shared/supportCore.ts'
import { accountBase, adminClient, cors, env, errorResponse, HttpError, json, requireSupportUser, twilioFormRequest } from '../_shared/supportTwilio.ts'

const asText = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GENERIC_FAIL = 'That email and code do not match, or the invite has expired. Check them, or ask your administrator for a new code.'

// Best-effort per-instance IP brake. Per-invite cooldowns and holds are database-authoritative.
const hits = new Map<string, number[]>()
function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
  return list.length > max
}

type Channel = 'email' | 'whatsapp'
type Result = { ok: boolean; detail: string }

async function sendEmail(to: string, msg: { subject: string; text: string; html: string }): Promise<Result> {
  const key = env('RESEND_API_KEY', false)
  const from = env('SUPPORT_INVITE_FROM_EMAIL', false)
  if (!key || !from) return { ok: false, detail: 'Email is not configured (RESEND_API_KEY and SUPPORT_INVITE_FROM_EMAIL)' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: env('SUPPORT_INVITE_REPLY_TO', false) || undefined }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.error('resend failed', res.status, (await res.text()).slice(0, 300))
      return { ok: false, detail: `Email provider refused it (${res.status})` }
    }
    return { ok: true, detail: 'sent' }
  } catch (e) {
    console.error('resend error', e)
    return { ok: false, detail: 'Email provider could not be reached' }
  }
}

async function sendWhatsApp(phone: string, name: string, code: string, joinUrl: string, text: string): Promise<Result> {
  const to = normalizePhone(phone)
  if (!to) return { ok: false, detail: 'No valid WhatsApp number on the invite' }
  const from = env('SUPPORT_INVITE_WA_FROM', false)
  if (!from || !env('TWILIO_ACCOUNT_SID', false)) return { ok: false, detail: 'WhatsApp is not configured (Twilio account and SUPPORT_INVITE_WA_FROM)' }
  const contentSid = env('SUPPORT_INVITE_WA_CONTENT_SID', false)
  try {
    // Business-initiated WhatsApp needs an approved template. Without one it only works
    // inside a 24 hour conversation window, so we say that plainly if Twilio refuses.
    const params: Record<string, string> = { To: `whatsapp:${to}`, From: `whatsapp:${normalizePhone(from) || from}` }
    if (contentSid) {
      params.ContentSid = contentSid
      params.ContentVariables = JSON.stringify({ '1': name.split(/\s+/)[0] || 'there', '2': code, '3': joinUrl || 'the join page' })
    } else {
      params.Body = text
    }
    await twilioFormRequest(`${accountBase()}/Messages.json`, params)
    return { ok: true, detail: 'sent' }
  } catch {
    return { ok: false, detail: contentSid ? 'Twilio refused the WhatsApp message' : 'Twilio refused it. Without an approved template WhatsApp only delivers inside an open conversation' }
  }
}

async function deliver(
  admin: ReturnType<typeof adminClient>, inviteId: string, channels: Channel[],
  invite: { email: string; full_name: string; phone?: string | null }, code: string,
): Promise<Record<string, Result>> {
  const joinUrl = env('SUPPORT_JOIN_URL', false)
  const msg = inviteMessage({ name: invite.full_name, code, joinUrl })
  const out: Record<string, Result> = {}
  for (const ch of channels) {
    const r = ch === 'email' ? await sendEmail(invite.email, msg) : await sendWhatsApp(invite.phone || '', invite.full_name, code, joinUrl, msg.text)
    out[ch] = r
    await admin.rpc('support_invite_record_delivery', { p_invite: inviteId, p_channel: ch, p_ok: r.ok, p_detail: r.detail })
  }
  return out
}

const parseChannels = (v: unknown): Channel[] =>
  (Array.isArray(v) ? v : []).filter((c): c is Channel => c === 'email' || c === 'whatsapp').filter((c, i, a) => a.indexOf(c) === i)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const action = asText(body?.action, 20)

    // ------------------------------------------------------------- redeem (public)
    if (action === 'redeem') {
      const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
      if (tooMany(`ip:${ip}`, 20, 10 * 60_000)) throw new HttpError(429, GENERIC_FAIL)
      const email = asText(body?.email, 254).toLowerCase()
      const code = normalizeInviteCode(body?.code)
      if (!isValidEmail(email) || code.length < 8) throw new HttpError(400, GENERIC_FAIL)

      const admin = adminClient()
      const { data: chk, error: chkError } = await admin.rpc('support_invite_check', { p_email: email, p_code: code })
      if (chkError) throw chkError
      if (!chk?.ok) {
        await new Promise((r) => setTimeout(r, 400))
        throw new HttpError(400, GENERIC_FAIL)
      }

      const escapedEmail = email.replace(/[\\%_]/g, (c) => '\\' + c)
      const { data: existing, error: existingError } = await admin
        .from('employee_profiles')
        .select('id')
        .ilike('email', escapedEmail)
        .maybeSingle()
      if (existingError) throw existingError

      if (existing?.id) {
        const { error: doneError } = await admin.rpc('support_invite_complete', { p_invite: chk.invite_id, p_user: existing.id })
        if (doneError) {
          console.error('invite complete failed', doneError.message)
          throw new HttpError(500, 'Could not finish setting up your access. Ask your administrator to send a new code.')
        }
        return json(req, { ok: true, existingAccount: true, name: chk.full_name })
      }

      if (!body?.password) {
        return json(req, { ok: true, needsPassword: true, name: chk.full_name })
      }

      const weak = validateJoinPassword(body.password, email)
      if (weak) throw new HttpError(400, weak)

      const { data: made, error: makeError } = await admin.auth.admin.createUser({
        email,
        password: String(body.password),
        email_confirm: true,
        user_metadata: { full_name: chk.full_name },
      })
      if (makeError || !made?.user) {
        console.error('createUser failed', makeError?.message)
        throw new HttpError(409, 'An account with that email already exists. Sign in instead, or ask your administrator for help.')
      }

      const userId = made.user.id
      const { error: doneError } = await admin.rpc('support_invite_complete', { p_invite: chk.invite_id, p_user: userId })
      if (doneError) {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined)
        console.error('invite complete failed', doneError.message)
        throw new HttpError(500, 'Could not finish setting up your access. Ask your administrator to send a new code.')
      }
      return json(req, { ok: true, existingAccount: false, name: chk.full_name })
    }

    // ------------------------------------------------------------- admin actions
    const { admin, employeeId } = await requireSupportUser(req)

    if (action === 'create') {
      const email = asText(body?.email, 254).toLowerCase()
      const channels = parseChannels(body?.channels)
      const code = generateInviteCode((n) => crypto.getRandomValues(new Uint8Array(n)))
      const { data: made, error } = await admin.rpc('support_invite_create', {
        p_actor: employeeId, p_email: email, p_name: asText(body?.fullName, 120), p_phone: asText(body?.phone, 40),
        p_role_kind: asText(body?.roleKind, 20) || 'agent', p_job_title: asText(body?.jobTitle, 80), p_code: code,
      })
      if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message)
      let teamId = asText(body?.teamId, 64)
      // A team-limited supervisor can only bring people into their own team.
      const { data: myScope } = await admin.rpc('support_supervisor_scope', { p_user: employeeId })
      if (myScope === 'team') {
        const { data: mine } = await admin.from('support_agents').select('team_id').eq('employee_id', employeeId).maybeSingle()
        teamId = mine?.team_id || ''
      }
      if (uuidRe.test(teamId)) {
        const { error: teamError } = await admin.rpc('support_invite_set_team', { p_actor: employeeId, p_invite: made.id, p_team: teamId })
        if (teamError) throw new HttpError(400, teamError.message)
      }
      const delivery = await deliver(admin, made.id, channels, { email, full_name: made.full_name, phone: normalizePhone(body?.phone) || null }, code)
      return json(req, { ok: true, inviteId: made.id, expiresAt: made.expires_at, code, delivery, joinUrl: env('SUPPORT_JOIN_URL', false) || null })
    }

    if (action === 'resend') {
      const inviteId = asText(body?.inviteId, 64)
      if (!uuidRe.test(inviteId)) throw new HttpError(400, 'inviteId is required')
      const code = generateInviteCode((n) => crypto.getRandomValues(new Uint8Array(n)))
      const { data: made, error } = await admin.rpc('support_invite_reissue', { p_actor: employeeId, p_invite: inviteId, p_code: code })
      if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message)
      const delivery = await deliver(admin, inviteId, parseChannels(body?.channels), { email: made.email, full_name: made.full_name, phone: made.phone }, code)
      return json(req, { ok: true, inviteId, expiresAt: made.expires_at, code, delivery, joinUrl: env('SUPPORT_JOIN_URL', false) || null })
    }

    if (action === 'revoke') {
      const inviteId = asText(body?.inviteId, 64)
      if (!uuidRe.test(inviteId)) throw new HttpError(400, 'inviteId is required')
      const { error } = await admin.rpc('support_invite_revoke', { p_actor: employeeId, p_invite: inviteId })
      if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message)
      return json(req, { ok: true })
    }

    if (action === 'delegate') {
      const target = asText(body?.employeeId, 64)
      if (!uuidRe.test(target)) throw new HttpError(400, 'employeeId is required')
      const { error } = await admin.rpc('support_set_can_invite', { p_actor: employeeId, p_employee: target, p_value: body?.value === true })
      if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message)
      return json(req, { ok: true })
    }

    throw new HttpError(400, 'Unknown action')
  } catch (error) {
    return errorResponse(req, error)
  }
})
