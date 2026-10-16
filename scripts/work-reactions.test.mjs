import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/workReactions.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const M = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const row = (user_id, emoji, at) => ({ id: user_id + emoji, work_item_id: 'w', user_id, emoji, created_at: at })

test('reactions group by emoji in the order they first appeared and mark mine', () => {
  const groups = M.groupReactions([
    row('a', '🔥', '2026-01-01T10:00:01Z'), row('b', '👏', '2026-01-01T10:00:02Z'), row('b', '🔥', '2026-01-01T10:00:03Z'),
  ], 'b')
  assert.deepEqual(groups.map(g => [g.emoji, g.count, g.mine]), [['🔥', 2, true], ['👏', 1, true]])
})

test('toggling locally adds then removes my reaction', () => {
  const once = M.toggleReactionLocal([], 'w', 'me', '🎉')
  assert.equal(once.length, 1)
  assert.equal(M.toggleReactionLocal(once, 'w', 'me', '🎉').length, 0)
})

test('only fresh ribbons trigger a celebration', () => {
  const now = Date.parse('2026-01-01T10:00:30Z')
  assert.ok(M.isFreshRibbon({ created_at: '2026-01-01T10:00:20Z' }, now))
  assert.ok(!M.isFreshRibbon({ created_at: '2026-01-01T09:00:00Z' }, now))
})

test('there are eight colourful ribbons and golden is first', () => {
  assert.equal(M.RIBBONS.length, 8)
  assert.equal(M.RIBBONS[0].kind, 'golden')
  const css = readFileSync('src/work-reactions.css', 'utf8')
  for (const r of M.RIBBONS) assert.ok(css.includes(`.${r.kind}{--wrx-a`), r.kind)
})

test('database rules: ribbons need permission, writes go through functions', () => {
  const name = readdirSync('supabase/migrations').find(f => f.endsWith('_work_reactions_ribbons.sql'))
  const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
  assert.match(sql, /can_give_work_ribbon\(\)/)
  assert.match(sql, /revoke all on public\.work_item_reactions, public\.work_ribbons, public\.work_ribbon_grants from anon, authenticated/)
  assert.match(sql, /Only admins can hand out ribbon permission/)
  for (const kind of ['rainbow', 'diamond', 'fire', 'heart']) assert.ok(sql.includes(`'${kind}'`), kind)
})

test('the gift host is mounted once at the app root and buzzes', () => {
  assert.match(readFileSync('src/InternalApp.tsx', 'utf8'), /<RibbonGiftHost\/>/)
  const ui = readFileSync('src/components/WorkReactions.tsx', 'utf8')
  assert.match(ui, /navigator\.vibrate/)
  assert.match(ui, /mark_work_ribbons_seen/)
})
