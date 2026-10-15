import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell =
  readFileSync(
    'src/chat/ChatShell.tsx',
    'utf8',
  )

function composerSource() {
  const start =
    shell.indexOf('<MessageComposer')

  const end =
    shell.indexOf(
      '</MessageComposer>',
      start,
    )

  assert.ok(
    start >= 0 && end > start,
    'MessageComposer must exist in ChatShell',
  )

  return shell.slice(
    start,
    end,
  )
}

test(
  'chat composer Enter inserts a newline and the send icon submits',
  () => {
    const composer =
      composerSource()

    assert.match(
      composer,
      /enterKeyHint="enter"/,
      'mobile keyboard must expose Enter/Return rather than Send',
    )

    assert.doesNotMatch(
      composer,
      /requestSubmit\(\)/,
      'Enter must not submit the chat form',
    )

    assert.match(
      composer,
      /className="cmSend"[\s\S]*type="submit"/,
      'the explicit send button must remain the submission control',
    )
  },
)
