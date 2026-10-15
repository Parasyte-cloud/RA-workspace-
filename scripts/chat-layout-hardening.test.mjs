import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/chat.css', import.meta.url), 'utf8')

function selectorBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')
  return [...css.matchAll(pattern)].map(match => match[1])
}

function declarations(block, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'g')
  return [...block.matchAll(pattern)].map(match => match[1].trim())
}

test('chat composer stays anchored inside the thread instead of shifting right', () => {
  const blocks = selectorBlocks('.cmComposer')
  const positions = blocks.flatMap(block => declarations(block, 'position'))

  assert.ok(
    positions.includes('absolute'),
    'the floating composer must have an absolute positioning declaration',
  )

  assert.equal(
    positions.at(-1),
    'absolute',
    'the final composer position declaration must remain absolute; relative positioning leaves left/right offsets active and pushes the send button outside the thread',
  )
})

test('chat composer can shrink on compact widths without clipping the send action', () => {
  const textareaBlocks = selectorBlocks('.cmComposer textarea')
  const minWidths = textareaBlocks.flatMap(block => declarations(block, 'min-width'))

  assert.equal(
    minWidths.at(-1),
    '0',
    'the textarea flex item must allow shrinking so attach, voice and send controls stay inside narrow composers',
  )
})

test('modern mobile composer respects left right and bottom safe areas', () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*860px\)[\s\S]*?\.cmComposer\s*\{[\s\S]*?left:\s*max\(8px,\s*env\(safe-area-inset-left,\s*0px\)\)[\s\S]*?right:\s*max\(8px,\s*env\(safe-area-inset-right,\s*0px\)\)[\s\S]*?bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom,\s*0px\)\)/,
    'the final mobile composer geometry must keep the entire pill and send control inside phone safe areas',
  )
})
