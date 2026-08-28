import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AuthorizationError,
  authorizeEngineer
} from './auth.js'

const config={
  supabaseUrl:'https://workspace.supabase.co',
  supabaseAnonKey:'publishable-test-key',
  authTimeoutMs:1000
}

function jsonResponse(
  body:unknown,
  status=200
):Response{
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers:{
        'content-type':'application/json'
      }
    }
  )
}

test('authorizes an active engineer verified by Supabase',async()=>{
  const responses=[
    jsonResponse({id:'user-1',email:'engineer@ridearrivo.com'}),
    jsonResponse([{
      user_id:'user-1',
      email:'engineer@ridearrivo.com',
      role:'engineer'
    }])
  ]

  const fetcher:typeof fetch=async()=>responses.shift()!

  const engineer=await authorizeEngineer(
    'x'.repeat(64),
    config,
    fetcher
  )

  assert.equal(engineer.role,'engineer')
  assert.equal(engineer.id,'user-1')
})

test('rejects a valid user without an allowed server-side role',async()=>{
  const responses=[
    jsonResponse({id:'user-2',email:'employee@ridearrivo.com'}),
    jsonResponse([])
  ]

  const fetcher:typeof fetch=async()=>responses.shift()!

  await assert.rejects(
    authorizeEngineer(
      'x'.repeat(64),
      config,
      fetcher
    ),
    AuthorizationError
  )
})

test('rejects an invalid Supabase access token',async()=>{
  const fetcher:typeof fetch=async()=>
    jsonResponse({message:'invalid token'},401)

  await assert.rejects(
    authorizeEngineer(
      'x'.repeat(64),
      config,
      fetcher
    ),
    AuthorizationError
  )
})
