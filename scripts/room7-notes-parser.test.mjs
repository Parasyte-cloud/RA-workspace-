import assert from 'node:assert/strict'
import {parseMeetingNotes} from '../supabase/functions/_shared/roomNotes.ts'

const md=`# Weekly ops sync

## Overview
We reviewed driver onboarding and the refund backlog.

## Key decisions
- Launch the Abuja pilot on 3 November.
- Pause new partner venues until the audit closes.

## Action Items
- Hana Hr: send the leave list by Friday
- Sam Support will clear the refund backlog before 20th October
- [ ] Review the invoice template (Owner: Biola)
- Update the onboarding deck @Tolu by next week
- Check the vendor contract

## Open questions
- Who approves overtime for the pilot?
`
const n=parseMeetingNotes(md)
assert.equal(n.decisions.length,2)
assert.equal(n.questions.length,1)
assert.equal(n.actions.length,5)
assert.equal(n.actions[0].owner,'Hana Hr'); assert.equal(n.actions[0].due,'Friday')
assert.equal(n.actions[1].owner,'Sam Support'); assert.match(n.actions[1].due,/20th October/)
assert.equal(n.actions[2].owner,'Biola'); assert.ok(!/Owner/.test(n.actions[2].body))
assert.equal(n.actions[3].owner,'Tolu'); assert.equal(n.actions[3].due,'next week')
assert.equal(n.actions[4].owner,null)
// Bold pseudo headings and junk input
const b=parseMeetingNotes('**Next steps:**\n1. Ana to book the venue by tomorrow\n')
assert.equal(b.actions[0].owner,'Ana'); assert.equal(b.actions[0].due,'tomorrow')
for(const bad of ['',null,undefined,42,'   \n\n']) assert.deepEqual(parseMeetingNotes(bad),{decisions:[],actions:[],questions:[]})
// Duplicates collapse
assert.equal(parseMeetingNotes('## Actions\n- Pay the bill\n- Pay the bill\n').actions.length,1)
console.log('room7 notes parser ok')
import {matchOwner} from '../supabase/functions/_shared/roomNotes.ts'
const people=[{user_id:'1',display_name:'Hana Hr'},{user_id:'2',display_name:'Sam Support'},{user_id:'3',display_name:'Sam Okoye'}]
assert.equal(matchOwner('Hana',people),'1')
assert.equal(matchOwner('Sam Support',people),'2')
assert.equal(matchOwner('Sam',people),null,'two Sams: never guess')
assert.equal(matchOwner(null,people),null); assert.equal(matchOwner('Zed',people),null)
console.log('owner match ok')
