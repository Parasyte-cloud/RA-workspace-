import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const sql = readFileSync(new URL('../supabase/migrations/20261017140000_room7_delete_meeting.sql', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/modules/RoomModule.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/secondary-button.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/InternalApp.tsx', import.meta.url), 'utf8')

// Database: one checked entry point, no broad delete policy, pinned search_path.
assert.match(sql, /security definer/)
assert.match(sql, /set search_path = public, pg_temp/)
assert.match(sql, /for update/)
assert.match(sql, /r\.status <> 'ended'/)
assert.match(sql, /r\.created_by <> me and not is_admin/)
assert.match(sql, /revoke all on function public\.delete_workspace_room\(uuid\) from public, anon/)
assert.match(sql, /grant execute on function public\.delete_workspace_room\(uuid\) to authenticated/)
assert.ok(!/create policy[^;]*delete/i.test(sql), 'must not add a delete policy')

// UI: confirmation first, goes through the RPC, only for creator or admin, never on live meetings.
assert.match(ui, /window\.confirm\(`Delete "\$\{room\.title\}" permanently/)
assert.match(ui, /client\.rpc\('delete_workspace_room'/)
assert.match(ui, /\(isAdmin\|\|room\.created_by===myId\)/)
assert.ok(ui.indexOf("room.status==='ended'") > -1 && /recentRooms=meetingRooms\.filter\(room=>room\.status==='ended'\)/.test(ui))
assert.ok(!ui.includes('—'), 'no em dash')

// Dark mode: secondary buttons have both themes and the sheet is loaded.
assert.match(css, /html\[data-ra-theme='dark'\] \.secondaryButton/)
assert.ok(app.includes("import './secondary-button.css'"))
assert.ok(!css.includes('—'))
console.log('room7 delete meeting ok')
