/**
 * Real Chromium layout regression checks using the production CSS stack.
 * Run: node scripts/mobile-layout-browser.mjs [--output /path/to/report]
 * Requires Node >=22 and Chrome/Chromium. No npm dependencies, login or server.
 * BROWSER_PATH may name a Chrome/Chromium executable. A disposable profile is
 * used: the user's saved browser profile and production data are never opened.
 * The fixture preserves shell/dashboard/overlay structure; this is NOT an
 * authenticated React end-to-end test. See the accompanying audit report.
 */
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.indexOf('--output')
const output = arg < 0 ? await mkdtemp(join(tmpdir(), 'ra-layout-report-')) : resolve(process.argv[arg + 1] || (() => { throw new Error('--output requires a directory') })())
await mkdir(output, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const candidates = [process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')].filter(Boolean)
let executable
for (const candidate of candidates) {
  try { await access(candidate, constants.X_OK); executable = candidate; break } catch { /* next candidate */ }
}
if (!executable) throw new Error('Chrome/Chromium not found. Set BROWSER_PATH to its executable. Browser verification has NOT passed.')
if (typeof WebSocket === 'undefined') throw new Error('Node 22 or later is required for the built-in WebSocket client.')

const iconPaths = {
  HOME: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
  TASKS: '<path d="m3 6 2 2 3-4M11 6h10M3 12l2 2 3-4M11 12h10M3 18l2 2 3-4M11 18h10"/>',
  CHAT: '<path d="M3 3h15v12H8l-5 4zM21 8v13l-5-4"/>',
  MAIL: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 5 10 8L22 5"/>',
  MORE: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  SEARCH: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  BELL: '<path d="M6 9a6 6 0 0 1 12 0v6l3 3H3l3-3zM9 21h6"/>',
  NEXT: '<path d="m9 5 7 7-7 7"/>',
  GAUGE: '<path d="M3 18a10 10 0 1 1 18 0zM12 14l5-6"/>',
  CLOSE: '<path d="m5 5 14 14M19 5 5 19"/>',
}
const entry = await readFile(join(root, 'src/InternalApp.tsx'), 'utf8')
const ordered = [...entry.matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)].map(m => m[1])
if (!ordered.includes('responsive.css') || !ordered.includes('liquid-glass.css')) throw new Error('Unexpected entry CSS stack; inspect the current source before running this fixture.')
// CSS imported by the actual tested components before the shell ownership layer.
const extras = ['personal-dashboard.css', 'global-search.css', 'device-presence.css', 'workstation-guide.css', 'unified-chat.css', 'call-ringer.css', 'components/WorkspaceClock.css']
const styleFiles = [...new Set([...extras, ...ordered])]
const styles = (await Promise.all(styleFiles.map(async name => `<style data-source="${name}">${await readFile(join(root, 'src', name), 'utf8')}</style>`))).join('\n')
let html = (await readFile(join(root, 'scripts/fixtures/mobile-layout.html'), 'utf8')).replace('<!-- STYLES -->', styles)
html = html.replace(/@([A-Z]+)@/g, (_, key) => `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[key] || ''}</svg>`)
// Keep this structural fixture tied to the production markup it is testing.
for (const [file, names] of [
  ['src/App.tsx', ['workspaceMain', 'workspaceContent', 'topbarTitle', 'headerActions']],
  ['src/modules/PersonalDashboard.tsx', ['personalHeroCopy', 'todayHeroActions', 'todayDisclosure']],
  ['src/modules/PhoneNav.tsx', ['phoneTabs', 'phoneMoreLayer', 'phoneMoreSheet']],
]) {
  const source = await readFile(join(root, file), 'utf8')
  for (const name of names) if (!source.includes(name)) throw new Error(`Fixture needs review: ${file} no longer contains ${name}`)
}
await writeFile(join(output, 'fixture.html'), html)

const profile = await mkdtemp(join(tmpdir(), 'ra-layout-chrome-'))
const args = ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-dev-shm-usage', 'about:blank']
if (process.getuid?.() === 0) args.unshift('--no-sandbox')
const chrome = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
let browserError = ''
chrome.stderr.on('data', chunk => { browserError = (browserError + chunk).slice(-5000) })
chrome.on('error', error => { browserError += error.message })
let ws
const report = { browser: executable, platform: platform(), scope: 'Production CSS with representative DOM; not authenticated app E2E', styleFiles, assertions: 0, cases: 0, failures: [] }
const check = (ok, label, details = '') => { report.assertions++; if (!ok) report.failures.push({ label, details }) }
try {
  let port
  for (let i = 0; i < 120; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { /* startup */ }
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before startup: ${browserError}`)
    await sleep(100)
  }
  if (!port) throw new Error(`Timed out starting Chrome: ${browserError}`)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = pages.find(p => p.type === 'page')
  if (!target) throw new Error('No Chrome page target was created')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await send('Page.enable')
  const frame = (await send('Page.getFrameTree')).frameTree.frame.id
  await send('Page.setDocumentContent', { frameId: frame, html })
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const viewport = async (width, height = 810) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle() }
  const metrics = () => evaluate(`(() => {
    const read = s => { const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,cw:e.clientWidth,sw:e.scrollWidth,display:c.display} };
    const values={};for(const s of ['.shell','.workspaceMain','.content','.personalHero','.personalHeroCopy h2','.phoneTabs','.sidebar','.topbarTitle','[aria-label="Search the workspace"]','.notificationButton','.profileButton','.dashboardNotificationsTeaserHeader'])values[s]=read(s);
    values.navLabels=[...document.querySelectorAll('.phoneTabs button span')].map(e=>({cw:e.clientWidth,sw:e.scrollWidth}));
    values.headerChildren=[...document.querySelector('.dashboardNotificationsTeaserHeader').children].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom}});
    values.documentWidth=document.documentElement.scrollWidth;return values;
  })()`)
  const screenshots = new Set([320, 390, 430, 768, 1280])
  for (const width of [320, 360, 375, 390, 430, 599, 600, 640, 768, 810, 820, 1023, 1024, 1280, 1440, 1920]) {
    await viewport(width)
    for (const size of ['unset', 'compact', 'balanced', 'expanded', 'maximized']) {
      for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.raTheme=${JSON.stringify(theme)};${size === 'unset' ? 'delete document.documentElement.dataset.raSize' : `document.documentElement.dataset.raSize=${JSON.stringify(size)}`}`)
        await settle()
        const m = await metrics(), label = `${width}px/${size}/${theme}`
        report.cases++
        const shell=m['.shell'], content=m['.content']
        check(m.documentWidth<=width+1, `${label}: no document horizontal overflow`, m.documentWidth)
        check(shell.w>0 && shell.x>=-1 && shell.right<=width+1, `${label}: frame stays inside viewport`, shell)
        check(content.w>0 && content.right<=shell.right+1, `${label}: content stays inside frame`, content)
        check(m['.personalHero'].sw<=m['.personalHero'].cw+1, `${label}: hero content is not clipped`, m['.personalHero'])
        check(m['.dashboardNotificationsTeaserHeader'].sw<=m['.dashboardNotificationsTeaserHeader'].cw+1, `${label}: notification heading fits`, m['.dashboardNotificationsTeaserHeader'])
        const children=m.headerChildren
        check(children[0].right<=children[1].x+1 || children[0].bottom<=children[1].y+1, `${label}: notification heading children do not overlap`, children)
        if (width<600) {
          check(shell.w>=width-2, `${label}: phone frame uses full width`, shell)
          check(m['.phoneTabs'].w>=width-2, `${label}: bottom navigation uses full width`, m['.phoneTabs'])
          check(m.navLabels.every(s=>s.sw<=s.cw+1), `${label}: bottom labels are readable`, m.navLabels)
          check(m['.sidebar'].display==='none', `${label}: no desktop sidebar on phone`)
        } else {
          check(m['.phoneTabs'].display==='none', `${label}: no phone bar on tablet/desktop`)
          check(m['.sidebar'].w>0, `${label}: tablet/desktop sidebar is visible`)
        }
        if (width<1024) for (const s of ['[aria-label="Search the workspace"]','.notificationButton','.profileButton']) check(m[s].w>=44 && m[s].h>=44, `${label}: ${s} visible 44px touch target`, m[s])
        if (size==='balanced' && theme==='light' && screenshots.has(width)) {
          const shot=await send('Page.captureScreenshot', { format:'png' })
          await writeFile(join(output, `dashboard-${width}.png`), Buffer.from(shot.data,'base64'))
        }
      }
    }
  }
  // Transparent buttons must not fall back to black browser-default text in dark mode.
  for (const width of [390,1280]) {
    await viewport(width)
    await evaluate(`document.documentElement.dataset.raSize='balanced';document.documentElement.dataset.raTheme='dark'`)
    const contrasts=await evaluate(`(()=>{
      const parse=color=>(color.match(/[\\d.]+/g)||[]).map(Number);
      const blend=(fg,bg,alpha=fg[3]??1)=>fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha));
      const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      const card=document.querySelector('.dashboardNotificationsTeaser');
      const bg=blend(parse(getComputedStyle(card).backgroundColor),[0,0,0]);
      return ['.dashboardNotificationsTeaserViewAll','.dashboardNotificationsTeaserItem>small'].map(selector=>{
        const e=document.querySelector(selector),c=getComputedStyle(e);let opacity=1;
        for(let n=e;n&&n!==card;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);
        const fg=blend(parse(c.color),bg,opacity),a=luminance(fg),b=luminance(bg);
        return {selector,color:c.color,opacity,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    })()`)
    report.cases++
    for(const contrast of contrasts)check(contrast.ratio>=4.5, `${width}px: dark notification text remains readable (${contrast.selector})`,contrast)
    if(width===390){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'dashboard-390-dark.png'),Buffer.from(shot.data,'base64'))}
  }
  await evaluate(`document.documentElement.dataset.raSize='balanced';document.documentElement.dataset.raTheme='light'`)
  // Names and action labels may be longer than the sample screenshot.
  for (const width of [320, 390, 600, 820]) {
    await viewport(width)
    await evaluate(`document.querySelector('.personalHeroCopy h2').textContent='Good afternoon, AbiolaWithAnExceptionallyLongUnbrokenName.';document.querySelector('.todayHeroActions button').textContent='Open AdministrationAndOperationsWorkstation';`)
    const m=await metrics();report.cases++
    check(m['.personalHero'].sw<=m['.personalHero'].cw+1, `${width}px: long hero name/action remains inside card`, m['.personalHero'])
  }
  // Fixed overlays must be viewport-sized, not trapped inside the glass header.
  for (const [width,height] of [[320,810],[390,400],[430,810],[768,810],[1280,810]]) {
    await viewport(width,height)
    for (const [id,parent,selector] of [['search-template','.headerActions','.searchModal'],['module-template','.personalDashboard','[data-test="module-modal"]']]) {
      await evaluate(`document.querySelector(${JSON.stringify(parent)}).append(document.getElementById(${JSON.stringify(id)}).content.cloneNode(true))`)
      await settle()
      const r=await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),p=e.firstElementChild.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,panel:{x:p.x,y:p.y,right:p.right,bottom:p.bottom}}})()`)
      report.cases++
      check(Math.abs(r.x)<=1&&Math.abs(r.y)<=1&&r.w>=width-1&&r.h>=height-1, `${width}x${height}: ${id} covers viewport`,r)
      check(r.panel.x>=-1&&r.panel.y>=-1&&r.panel.right<=width+1&&r.panel.bottom<=height+1, `${width}x${height}: ${id} panel is fully reachable`, r.panel)
      const hits=await evaluate(`(()=>{const overlay=document.querySelector(${JSON.stringify(selector)});return [[10,10],[10,${height}-10],[${width}/2,${height}/2]].map(([x,y])=>{const hit=document.elementFromPoint(x,y);return {x,y,inside:!!hit&&overlay.contains(hit),target:hit?.className}})})()`)
      check(hits.every(hit=>hit.inside), `${width}x${height}: ${id} receives input above underlying navigation`, hits)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).remove()`)
    }
  }
  for (const width of [320,430]) {
    await viewport(width)
    await evaluate(`document.documentElement.style.setProperty('--ra-safe-bottom','34px');document.querySelector('.shell').append(document.getElementById('more-template').content.cloneNode(true))`)
    const m=await evaluate(`(()=>{let l=document.querySelector('.phoneMoreLayer').getBoundingClientRect(),s=document.querySelector('.phoneMoreSheet').getBoundingClientRect();return {x:l.x,y:l.y,w:l.width,h:l.height,bottom:s.bottom}})()`)
    report.cases++
    check(Math.abs(m.x)<=1&&m.w>=width-1&&m.h>=809&&m.bottom<=811, `${width}px: More sheet covers viewport`,m)
    await evaluate(`(()=>{document.querySelector('.phoneMoreLayer').remove();const c=document.querySelector('.content');c.scrollTop=c.scrollHeight})()`)
    await settle()
    const end=await evaluate(`(()=>{const e=document.querySelector('[data-test="last-action"]').getBoundingClientRect(),n=document.querySelector('.phoneTabs').getBoundingClientRect();return {last:e.bottom,navTop:n.top}})()`)
    check(end.last<=end.navTop+1, `${width}px: last action scrolls above safe-area nav`,end)
    await evaluate(`document.querySelector('.content').scrollTop=0;document.documentElement.style.removeProperty('--ra-safe-bottom')`)
  }
  // Shared forms and deliberate table scrolling must not widen the page.
  await evaluate(`document.querySelector('.content').replaceChildren(document.getElementById('data-template').content.cloneNode(true))`)
  for (const width of [320,390,768,1280]) {
    await viewport(width)
    const r=await evaluate(`(()=>{const c=document.querySelector('.content'),t=document.querySelector('.responsiveTableScroller'),f=document.querySelector('.responsiveFormGrid');return {cw:c.clientWidth,sw:c.scrollWidth,table:t.scrollWidth,tableViewport:t.clientWidth,columns:getComputedStyle(f).gridTemplateColumns}})()`)
    report.cases++
    check(r.sw<=r.cw+1, `${width}px: data/form surface does not widen content`,r)
    if(width<600)check(r.table>r.tableViewport, `${width}px: wide table scrolls locally`,r)
  }
  const passed=report.assertions-report.failures.length
  await writeFile(join(output,'results.json'),JSON.stringify({...report,passed},null,2)+'\n')
  console.log(`${passed}/${report.assertions} browser assertions passed across ${report.cases} cases.`)
  console.log(`Report: ${output}`)
  for (const failure of report.failures.slice(0,18)) console.error(`FAIL ${failure.label}: ${JSON.stringify(failure.details)}`)
  if(report.failures.length>18)console.error(`... ${report.failures.length-18} further failures in results.json`)
  process.exitCode=report.failures.length?1:0
} finally {
  ws?.close()
  chrome.kill('SIGTERM')
  for(let i=0;i<30&&chrome.exitCode===null;i++)await sleep(100)
  if(chrome.exitCode===null)chrome.kill('SIGKILL')
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
