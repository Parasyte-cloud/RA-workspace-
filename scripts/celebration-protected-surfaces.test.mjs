import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const read=p=>fs.readFileSync(p,'utf8')
const cases=[
 ['src/modules/RoomMeeting.tsx','room7_live'],
 ['src/modules/SupportSoftphone.tsx','support_call'],
 ['src/modules/SupportAssistedBookingPanel.tsx','payment_flow'],
 ['src/modules/BlogStudio.tsx','critical_unsaved_form'],
 ['src/modules/LetterheadStudio.tsx','critical_unsaved_form'],
 ['src/modules/SheetEditor.tsx','critical_unsaved_form'],
]
test('protected surfaces register explicit celebration blockers',()=>{for(const [p,r] of cases){const s=read(p);assert.match(s,/useCelebrationBlocker/,p);assert.match(s,new RegExp(`['"]${r}['"]`),p)}})
test('queue checks blocker and document visibility before claiming',()=>{const s=read('src/celebrations/useRecognitionCeremonyQueue.ts');assert.match(s,/blockedBySurface/);assert.match(s,/visibilityState/);assert.match(s,/pendingSessionCount >= MAX_AUTOMATIC_CEREMONIES/);assert.match(s,/if \(!supabase \|\| !userId \|\| current \|\| blocked/)} )
