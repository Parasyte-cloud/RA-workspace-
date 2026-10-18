// Motion for the phone islands (the top bar and the dock).
//
// Two things live here:
//  1. The bounce. When the top bar shrinks or grows, or the screen changes, the title, the buttons
//     and the dock tabs take a small staggered spring. It is played with the Web Animations API, so
//     it restarts every time and no CSS rule elsewhere can switch it off by accident.
//  2. The liquid glow. A small element is added inside the bar and the dock; island.css animates it
//     while <html data-ra-fun="on">. The same file keeps data-ra-beat, which switches the pulse of the
//     names and icons.
//
// Everything here respects the phone's Reduce Motion setting by default. Settings lets a person turn
// the motion on or off for this device whatever the phone says, and turn the pulse of names and
// icons off on its own.

export const FUN_KEY='ra-island-fun'
export const BEAT_KEY='ra-island-beat'
export const FUN_EVENT='ra-island-fun-change'
const SPRING='cubic-bezier(.3,1.9,.5,1)'

export function reduceMotion():boolean{
  try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}
}
// 'auto' follows the phone's Reduce Motion setting; 'always' and 'off' are the person's own choice.
export type FunChoice='auto'|'always'|'off'
export function funChoice():FunChoice{
  try{
    const v=window.localStorage.getItem(FUN_KEY)
    return v==='always'||v==='off'?v:'auto'
  }catch{return 'auto'}
}
export function setFunChoice(choice:FunChoice){
  try{
    if(choice==='auto')window.localStorage.removeItem(FUN_KEY)
    else window.localStorage.setItem(FUN_KEY,choice)
  }catch{/* storage blocked: the setting just does not stick */}
  window.dispatchEvent(new Event(FUN_EVENT))
}
// Pulse of the names and icons. On by default, switched off in Settings.
export function beatEnabled():boolean{
  try{return window.localStorage.getItem(BEAT_KEY)!=='off'}catch{return true}
}
export function setBeatEnabled(on:boolean){
  try{
    if(on)window.localStorage.removeItem(BEAT_KEY)
    else window.localStorage.setItem(BEAT_KEY,'off')
  }catch{/* storage blocked */}
  window.dispatchEvent(new Event(FUN_EVENT))
}
export function funAllowed():boolean{
  const choice=funChoice()
  if(choice==='always')return true
  if(choice==='off')return false
  return !reduceMotion()
}
function onPhone():boolean{
  try{return window.matchMedia('(max-width: 599px)').matches}catch{return false}
}

type Kind='grow'|'shrink'|'screen'
const FRAMES:Record<Kind,{title:Keyframe[],button:Keyframe[],tab:Keyframe[]}>={
  shrink:{
    title:[{transform:'translateX(18px) scale(1.3)'},{transform:'none'}],
    button:[{transform:'scale(1.65)'},{transform:'none'}],
    tab:[{transform:'translateY(-12px) scale(1.4)'},{transform:'none'}],
  },
  grow:{
    title:[{transform:'translateX(-16px) scale(.8)'},{transform:'none'}],
    button:[{transform:'scale(.5)'},{transform:'none'}],
    tab:[{transform:'translateY(12px) scale(.6)'},{transform:'none'}],
  },
  screen:{
    title:[{transform:'translateX(-16px) scale(.8)'},{transform:'none'}],
    button:[{transform:'scale(.55)'},{transform:'none'}],
    tab:[{transform:'translateY(12px) scale(.6)'},{transform:'none'}],
  },
}

export function playIslandBounce(kind:Kind,doc:Document=document){
  if(!funAllowed() || !onPhone())return
  const run=(selector:string,frames:Keyframe[],step:number,duration:number)=>{
    doc.querySelectorAll<HTMLElement>(selector).forEach((el,index)=>{
      if(typeof el.animate!=='function')return
      el.animate(frames,{duration,delay:index*step,easing:SPRING})
    })
  }
  const set=FRAMES[kind]
  run('.shell.glassFrame .topbar .topbarTitle',set.title,0,720)
  run('.shell.glassFrame .topbar .headerActions > *',set.button,50,640)
  run('nav.phoneTabs button:not(.active)',set.tab,45,600)
}

function ensureGlow(doc:Document){
  doc.querySelectorAll<HTMLElement>('.shell.glassFrame .topbar, nav.phoneTabs').forEach(host=>{
    if(host.querySelector(':scope > .raGlow'))return
    const glow=doc.createElement('span')
    glow.className='raGlow'
    glow.setAttribute('aria-hidden','true')
    host.prepend(glow)
  })
}

export function startIslandMotion(root:HTMLElement=document.documentElement):()=>void{
  const doc=root.ownerDocument
  let frame=0
  const syncFun=()=>{
    root.setAttribute('data-ra-fun',funAllowed()?'on':'off')
    root.setAttribute('data-ra-beat',funAllowed()&&beatEnabled()?'on':'off')
  }
  syncFun()
  ensureGlow(doc)

  let island=root.getAttribute('data-ra-island')
  let pulse=root.getAttribute('data-ra-pulse')
  const attrs=new MutationObserver(()=>{
    const nextIsland=root.getAttribute('data-ra-island')
    const nextPulse=root.getAttribute('data-ra-pulse')
    if(nextPulse!==pulse){
      pulse=nextPulse
      island=nextIsland
      playIslandBounce('screen',doc)
      return
    }
    if(nextIsland!==island){
      const was=island
      island=nextIsland
      if(was)playIslandBounce(nextIsland==='compact'?'shrink':'grow',doc)
    }
  })
  attrs.observe(root,{attributes:true,attributeFilter:['data-ra-island','data-ra-pulse']})

  // The bar and the dock mount after the first paint and again after sign in.
  const tree=new MutationObserver(()=>{
    if(frame)return
    frame=window.requestAnimationFrame(()=>{frame=0;ensureGlow(doc)})
  })
  tree.observe(doc.body,{childList:true,subtree:true})

  const motion=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null
  motion?.addEventListener?.('change',syncFun)
  window.addEventListener(FUN_EVENT,syncFun)

  return()=>{
    attrs.disconnect()
    tree.disconnect()
    if(frame)window.cancelAnimationFrame(frame)
    motion?.removeEventListener?.('change',syncFun)
    window.removeEventListener(FUN_EVENT,syncFun)
    root.removeAttribute('data-ra-fun')
    root.removeAttribute('data-ra-beat')
    doc.querySelectorAll('.raGlow').forEach(el=>el.remove())
  }
}
