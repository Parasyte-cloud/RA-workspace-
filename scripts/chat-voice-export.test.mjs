import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async path => {
  const js = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const V = await load('src/lib/voiceNote.ts')
const X = await load('src/lib/chatExport.ts')
const ui = readFileSync('src/modules/ChatModule.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/20261012230000_chat_voice_notes.sql', 'utf8')

test('the recorder picks the best format the browser supports, or none', () => {
  assert.equal(V.pickRecorderMime(m => m === 'audio/mp4'), 'audio/mp4')
  assert.equal(V.pickRecorderMime(() => true), 'audio/webm;codecs=opus')
  assert.equal(V.pickRecorderMime(() => false), null)
  assert.equal(V.baseMime('audio/webm;codecs=opus'), 'audio/webm')
})

test('voice notes get a readable file name and a clean duration', () => {
  assert.equal(V.voiceFileName(new Date(2026, 9, 12, 17, 5), 'audio/webm;codecs=opus'), 'Voice note 2026-10-12 17-05.webm')
  assert.equal(V.voiceFileName(new Date(2026, 9, 12, 17, 5), 'audio/mp4'), 'Voice note 2026-10-12 17-05.m4a')
  assert.equal(V.formatDuration(0), '0:00')
  assert.equal(V.formatDuration(65_400), '1:05')
  assert.equal(V.MAX_VOICE_MS, 600000)
})

test('the transcript shows who said what, replies and files, grouped by day', () => {
  const names = { a: 'Ada', b: 'Bayo' }
  const text = X.buildTranscript({
    title: 'Bayo', exportedBy: 'Ada', exportedAt: new Date(2026, 9, 12, 18, 0),
    nameOf: id => names[id],
    messages: [
      { id: '1', sender_id: 'a', body: 'Hello', created_at: new Date(2026, 9, 12, 9, 1).toISOString() },
      { id: '2', sender_id: 'b', body: 'Hi\nthere', created_at: new Date(2026, 9, 12, 9, 2).toISOString(), reply_to_id: '1' },
      { id: '3', sender_id: 'a', body: '', created_at: new Date(2026, 9, 13, 8, 0).toISOString(), attachment_name: 'q.pdf', attachment_mime: 'application/pdf', attachment_size: 2048 },
    ],
    savedAs: new Map([['3', 'files/q.pdf']]),
  })
  assert.match(text, /^RideArrivo chat: Bayo\nExported by Ada on 2026-10-12 18:00\n3 messages/)
  assert.match(text, /--- 2026-10-12 ---/)
  assert.match(text, /--- 2026-10-13 ---/)
  assert.match(text, /\[09:01\] Ada: Hello/)
  assert.match(text, /\(replying to Ada: Hello\)/)
  assert.match(text, /\n {4}Hi\n {4}there/)
  assert.match(text, /\[File: q\.pdf \(2 KB\) -> files\/q\.pdf\]/)
})

test('two files with the same name never overwrite each other in the zip', () => {
  const taken = new Set()
  assert.equal(X.uniqueZipName(taken, 'a.png'), 'a.png')
  assert.equal(X.uniqueZipName(taken, 'A.png'), 'A (2).png')
  assert.equal(X.uniqueZipName(taken, 'a.png'), 'a (3).png')
  assert.equal(X.uniqueZipName(new Set(), '../x:y?.pdf'), '.._x_y_.pdf')
  assert.equal(X.exportFileName('Bayo', new Date(2026, 9, 12), 'zip'), 'RideArrivo chat with Bayo 2026-10-12.zip')
})

test('voice notes are allowed in the bucket and announced in notifications', () => {
  assert.match(sql, /'audio\/webm'/)
  assert.match(sql, /attachment_duration_ms/)
  assert.match(sql, /'Sent a voice note'/)
})

test('downloads happen inside the workspace through the person\'s own session', () => {
  assert.match(ui, /storage\.from\(ATTACH_BUCKET\)\.download\(path\)/)
  assert.match(ui, /anchor\.download=name/)
  assert.ok(!/window\.open/.test(ui))
  assert.match(ui, /className="cmFileDl"/)
  assert.match(ui, /className="cmImageDl"/)
})

test('the screen records, previews before sending, and can export text or a zip', () => {
  assert.match(ui, /navigator\.mediaDevices\?\.getUserMedia/)
  assert.match(ui, /Send voice note/)
  assert.match(ui, /Discard voice note/)
  assert.match(ui, /exportChat\(false\)/)
  assert.match(ui, /exportChat\(true\)/)
  assert.match(ui, /\.range\(from,from\+999\)/)
})
