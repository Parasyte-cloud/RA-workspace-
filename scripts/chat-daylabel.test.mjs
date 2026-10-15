import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const s=readFileSync('src/chat/ChatShell.tsx','utf8')
const i=s.indexOf('const dayLabel=')
assert(i>0)
assert(/Number\.isNaN\(date\.getTime\(\)\)\)return 'Earlier'/.test(s.slice(i,i+400)),'dayLabel must guard invalid dates')
const b=readFileSync('src/components/RouteErrorBoundary.tsx','utf8')
assert(b.includes('isStaleBuildError')&&b.includes('Reload app'))
console.log('chat-daylabel ok')
// Runtime check of the app-wide Intl guard.
import {build} from 'esbuild'
const out=await build({entryPoints:['src/lib/safeIntlDate.ts'],bundle:true,write:false,format:'esm'})
await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))
const f=new Intl.DateTimeFormat('en',{hour:'numeric'})
assert.equal(f.format(new Date('nope')),'Unknown date')
assert.ok(f.format(new Date('2026-01-01T10:00:00Z')).length>0)
console.log('safe intl ok')
