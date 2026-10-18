import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const src = fs.readFileSync(new URL('../src/lib/ringtone.ts', import.meta.url), 'utf8')
const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
const T = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('there are ten ringtones and Midnight Jazz is the default', () => {
  assert.equal(T.RINGTONES.length, 10)
  assert.equal(T.DEFAULT_RINGTONE, 'midnight')
  assert.equal(T.RINGTONES[0].id, 'midnight')
  const names = T.RINGTONES.map(r => r.label)
  for (const wanted of ['Midnight Jazz', 'Blue Note', 'Lounge', 'Cricket', 'Bell', 'Telephone']) assert.ok(names.includes(wanted))
  assert.equal(new Set(T.RINGTONES.map(r => r.id)).size, 10)
})

test('every ringtone fits its cycle, is quiet enough and audible', () => {
  for (const r of T.RINGTONES) {
    const p = r.pattern
    assert.ok(p.cycle >= 2 && p.cycle <= 4, r.id)
    assert.ok(p.tones.length > 0)
    for (const tone of p.tones) {
      assert.ok(tone.at >= 0 && tone.at + tone.dur < p.cycle, `${r.id} ends before the cycle repeats`)
      assert.ok(tone.gain > 0 && tone.gain <= 0.3, `${r.id} gain`)
      for (const f of tone.freqs) assert.ok(f >= 150 && f <= 5000, `${r.id} freq ${f}`)
    }
  }
})

test('unknown or missing choices fall back to Midnight Jazz; volume is clamped', () => {
  assert.equal(T.ringtonePattern('nope'), T.RINGTONES[0].pattern)
  assert.equal(T.isRingtoneId('bell'), true)
  assert.equal(T.isRingtoneId('<script>'), false)
  assert.equal(T.clampVolume(5), 1)
  assert.equal(T.clampVolume(-1), 0.2)
  assert.equal(T.clampVolume('abc'), T.DEFAULT_VOLUME)
})

test('the incoming ring uses the saved choice', () => {
  assert.match(src, /ringtonePattern\(readRingtone\(\)\)/)
  assert.ok(!src.includes('—'))
})
