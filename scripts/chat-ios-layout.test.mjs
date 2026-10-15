import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const shell=readFileSync('src/chat/ChatShell.tsx','utf8')
const css=readFileSync('src/chat-ios.css','utf8')
assert(shell.includes("import '../chat-ios.css'"),'chat-ios.css must load')
// Message actions live beside the bubble, never inside it.
const bubbleStart=shell.indexOf('className="cmBubble"')
const actions=shell.indexOf('className="cmActions"')
assert(bubbleStart>0&&actions>bubbleStart,'actions come after the bubble opens')
const betweenBubbleAndActions=shell.slice(bubbleStart,actions)
assert(!betweenBubbleAndActions.includes('<MessageToolbar'),'toolbar must not be inside the bubble')
assert(!betweenBubbleAndActions.includes('cmReplyBtn'),'reply/edit/delete must not be inside the bubble')
// Phone thread is a full screen flex column that stays below modals and above the nav.
assert(/cmShell\.threadOpen\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*70/.test(css))
assert(/\.callRinger\s*\{[^}]*z-index:\s*5000/.test(css),'call banner must sit above all bars')
console.log('chat-ios-layout ok')
assert(/body:has\(\.cm \.cmShell\.threadOpen\) \.phoneTabs/.test(css),'tab bar must step aside in an open chat so it cannot cover the message box')
assert(shell.includes("'--cm-vh'"),'open chat follows the visible area when the keyboard opens')
console.log('chat-ios-layout composer ok')
