import assert from 'node:assert/strict'
import { splitLinks, safeHref } from '../src/chat/linkify.ts'

const links = t => splitLinks(t).filter(p => p.type === 'link').map(p => p.text)
assert.deepEqual(links('see https://a.com/x.'), ['https://a.com/x'])
assert.deepEqual(links('(https://a.com/x)'), ['https://a.com/x'])
assert.deepEqual(links('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)'])
assert.deepEqual(links('go to www.rideArrivo.com, now'), ['www.rideArrivo.com'])
assert.equal(splitLinks('www.x.com')[0].href, 'https://www.x.com/')
assert.deepEqual(links('javascript:alert(1) and ftp://x.com'), [])
assert.deepEqual(links('https://user:pw@evil.com'), [])
assert.deepEqual(links('http://localhost'), [])
assert.deepEqual(links('foowww.x.com'), [])
assert.deepEqual(links('a https://a.com b http://b.org/p?q=1&r=2!'), ['https://a.com', 'http://b.org/p?q=1&r=2'])
assert.equal(splitLinks('plain').length, 1)
assert.equal(splitLinks('').length, 1)
assert.equal(splitLinks('hi https://a.com bye').map(p => p.text).join(''), 'hi https://a.com bye')
assert.equal(safeHref('data:text/html,x'), null)
console.log('chat-linkify ok')
