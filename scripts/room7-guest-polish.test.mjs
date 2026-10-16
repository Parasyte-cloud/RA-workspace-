import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../src/room7-public/ExternalRoom7App.tsx',import.meta.url),'utf8')
assert.ok(/function Room7Countdown/.test(app),'countdown has its own component')
assert.equal((app.match(/useCountdown\(/g)||[]).length,2,'only the definition and the countdown component use the timer, never the whole page')
assert.ok(/role="timer"/.test(app)&&/aria-hidden="true"/.test(app),'countdown is announced calmly')
assert.ok(/noindex, nofollow/.test(app),'event pages are not indexed')
assert.ok(/Room7AddToCalendar/.test(app))
// the calendar link must never carry the guest token or query string
assert.ok(/here\.search\s*=\s*''/.test(app)&&/here\.hash\s*=\s*''/.test(app))
const css=readFileSync(new URL('../src/room7-public/room7-public.css',import.meta.url),'utf8')
assert.ok(/room7PublicCalendar/.test(css))
assert.ok(!app.includes('—')&&!css.includes('—'))
console.log('room7 guest polish ok')
