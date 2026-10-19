#!/usr/bin/env node
// Creates the key pair that lets the server send web push alerts.
//
//   node scripts/generate-vapid-keys.mjs [--out vapid.private.env]
//
// The PRIVATE key is written to a file (permissions 600) and is never printed. Put the file's contents in your
// Supabase secrets, for example:   supabase secrets set --env-file vapid.private.env
// then delete the file. Never commit it, never paste it into a chat. Only the public key is printed.
//
// PArAsYtE | RA-Workspace support module

import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

const i = process.argv.indexOf('--out')
const out = i > -1 ? process.argv[i + 1] : 'vapid.private.env'
if (!out) { console.error('--out needs a file name'); process.exit(2) }
if (existsSync(out)) { console.error(`${out} already exists. Delete it or pick another name; keys are never overwritten.`); process.exit(1) }

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = privateKey.export({ format: 'jwk' })
const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url')
const publicKey = Buffer.concat([Buffer.from([4]), x, y]).toString('base64url')

writeFileSync(out, `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:support@ridearrivo.com\n`, { mode: 0o600 })
console.log(`Wrote ${out} (private, mode 600). Public key for reference:\n${publicKey}`)
