import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProtocolError,
  parseClientMessage
} from './protocol.js'

test('parses a valid authentication message',()=>{
  const message=parseClientMessage(JSON.stringify({
    type:'auth',
    accessToken:'x'.repeat(64),
    cols:120,
    rows:34
  }))

  assert.equal(message.type,'auth')
  assert.equal(message.cols,120)
})

test('rejects oversized terminal dimensions',()=>{
  assert.throws(
    ()=>parseClientMessage(JSON.stringify({
      type:'resize',
      cols:999,
      rows:34
    })),
    ProtocolError
  )
})

test('rejects unknown message types',()=>{
  assert.throws(
    ()=>parseClientMessage('{"type":"shell"}'),
    ProtocolError
  )
})
