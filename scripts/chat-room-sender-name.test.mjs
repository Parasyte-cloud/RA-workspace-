import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const helperPath = 'src/chat/messages/senderGrouping.ts'
const shellPath = 'src/chat/ChatShell.tsx'
const cssPath = 'src/chat.css'

async function helperModule() {
  assert.ok(existsSync(helperPath), `${helperPath} must exist`)
  const source = readFileSync(helperPath, 'utf8')
  const js = transformSync(source, { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

const shell = readFileSync(shellPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')

const row = (previousKind, previousSenderId = null) => ({
  isRoom: true,
  isOwn: false,
  senderId: 'person-b',
  previousKind,
  previousSenderId,
})

test('incoming room messages render a visible sender label', async () => {
  const { shouldShowRoomSenderLabel } = await helperModule()
  assert.equal(shouldShowRoomSenderLabel(row(null)), true)
  assert.match(shell, /shouldShowRoomSenderLabel/)
  assert.match(shell, /className="cmSenderName"/)
  assert.match(shell, /cmSenderName[^\n]*>[\s\S]*displayName\(sender\)/)
  assert.match(css, /\.cmSenderName\s*\{/)
})

test('direct messages do not render the room sender label', async () => {
  const { shouldShowRoomSenderLabel } = await helperModule()
  assert.equal(
    shouldShowRoomSenderLabel({ ...row(null), isRoom: false }),
    false,
  )
})

test('own room messages do not render the sender label', async () => {
  const { shouldShowRoomSenderLabel } = await helperModule()
  assert.equal(
    shouldShowRoomSenderLabel({ ...row(null), isOwn: true }),
    false,
  )
})

test('adjacent room messages from the same sender suppress the repeated label', async () => {
  const { shouldShowRoomSenderLabel } = await helperModule()
  assert.equal(
    shouldShowRoomSenderLabel(row('message', 'person-b')),
    false,
  )
  assert.equal(
    shouldShowRoomSenderLabel(row('message', 'person-a')),
    true,
  )
})

test('a day call or system row resets sender grouping', async () => {
  const { shouldShowRoomSenderLabel } = await helperModule()
  for (const previousKind of ['day', 'call', 'system']) {
    assert.equal(
      shouldShowRoomSenderLabel(row(previousKind, 'person-b')),
      true,
      `${previousKind} must reset the visible sender group`,
    )
  }
})

test('existing receipt and message action markers remain present', () => {
  for (const marker of [
    'cmReceipt',
    'cmReceiptLabel',
    'cmReplyBtn',
    'cmEditBtn',
    'cmDeleteBtn',
    'CheckCheck',
    'receiptState',
  ]) {
    assert.match(shell, new RegExp(marker), `${marker} must remain in ChatShell`)
  }
})
