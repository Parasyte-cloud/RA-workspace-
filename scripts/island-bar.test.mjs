import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const src=readFileSync(new URL('../src/lib/islandBar.ts',import.meta.url),'utf8')
const m=src.match(/export function nextIslandState[\s\S]*?\n}\n/)[0].replace('export ','').replace(/:'full'\|'compact'/g,'').replace(/:number/g,'')
const ON=24,OFF=8
const f=new Function('ISLAND_ON','ISLAND_OFF',m+';return nextIslandState')(ON,OFF)
assert.equal(f('full',10),'full'); assert.equal(f('full',40),'compact')
assert.equal(f('compact',15),'compact'); assert.equal(f('compact',3),'full')
assert.equal(f('full',NaN),'full'); assert.equal(f('compact',-50),'full')
const css=readFileSync(new URL('../src/island.css',import.meta.url),'utf8')
assert.ok(/border-radius: 999px !important/.test(css)); assert.ok(!css.includes('—'))
console.log('island bar ok')
assert.ok(/data-ra-island='compact'\] nav\.phoneTabs/.test(css),'dock shrinks too')
