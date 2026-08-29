import assert from 'node:assert/strict'
import test from 'node:test'

import { loadConfig } from './config.js'

function environment():NodeJS.ProcessEnv{
  return {
    SUPABASE_URL:'https://workspace.supabase.co/',
    SUPABASE_ANON_KEY:'publishable-test-key',
    PARASYTE_ALLOWED_ORIGINS:
      'https://workspace.ridearrivo.com/',
    PARASYTE_DOCKER_SOCKET:
      '/run/user/1001/docker.sock'
  }
}

test('loads secure gateway defaults',()=>{
  const config=loadConfig(environment())

  assert.equal(
    config.supabaseUrl,
    'https://workspace.supabase.co'
  )
  assert.equal(
    config.allowedOrigins.has(
      'https://workspace.ridearrivo.com'
    ),
    true
  )
  assert.equal(
    config.publicOrigin,
    'https://linux.ridearrivo.com'
  )
  assert.equal(
    config.containerNetworkPrefix,
    'parasyte-engineer'
  )
  assert.equal(config.sessionMaxMs,3_600_000)
  assert.equal(config.ideSessionMaxMs,3_600_000)
  assert.equal(config.githubOrg,'Parasyte-cloud')
  assert.equal(config.githubAppId,null)
})

test('refuses the root Docker socket',()=>{
  assert.throws(
    ()=>loadConfig({
      ...environment(),
      PARASYTE_DOCKER_SOCKET:'/var/run/docker.sock'
    }),
    /rootless Docker daemon/
  )
})

test('rejects an unsafe network prefix',()=>{
  assert.throws(
    ()=>loadConfig({
      ...environment(),
      PARASYTE_CONTAINER_NETWORK_PREFIX:'bad prefix'
    }),
    /invalid characters/
  )
})

test('requires complete GitHub App configuration',()=>{
  assert.throws(
    ()=>loadConfig({
      ...environment(),
      GITHUB_APP_ID:'123'
    }),
    /configured together/
  )
})

test('rejects malformed GitHub identifiers and organization names',()=>{
  assert.throws(
    ()=>loadConfig({
      ...environment(),
      GITHUB_APP_ID:'not-a-number'
    }),
    /GITHUB_APP_ID must be numeric/
  )

  assert.throws(
    ()=>loadConfig({
      ...environment(),
      GITHUB_ORG:'bad org name'
    }),
    /valid GitHub organization name/
  )
})
