import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const s=readFileSync(new URL('../src/chat/ChatShell.tsx',import.meta.url),'utf8')
assert.match(s,/recentMessages\.length>=500/,'full 500 window falls back to per chat queries')
assert.match(s,/baseTimerRef\.current=window\.setTimeout/,'room inserts debounce the list reload')
assert.match(s,/clearTimeout\(baseTimerRef\.current\)/,'debounce timer is cleaned up')
console.log('chat audit round 3 ok')
