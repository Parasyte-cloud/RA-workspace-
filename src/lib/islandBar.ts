// Dynamic Island style header: the top bar is a full width pill at the top of a
// page and shrinks to a compact pill once the page is scrolled. The state is a
// single attribute on <html>, so CSS does all the animation.
export const ISLAND_ON=24
export const ISLAND_OFF=8

// Hysteresis: grow back only near the top, so the pill never flickers while a
// finger rests around the threshold.
export function nextIslandState(current:'full'|'compact',scrollTop:number):'full'|'compact'{
  const y=Number.isFinite(scrollTop)?Math.max(0,scrollTop):0
  if(current==='full')return y>ISLAND_ON?'compact':'full'
  return y<ISLAND_OFF?'full':'compact'
}

export function startIslandBar(root:HTMLElement=document.documentElement):()=>void{
  let state:'full'|'compact'='full'
  let frame=0
  root.setAttribute('data-ra-island',state)

  const read=(target:EventTarget|null)=>{
    if(target===document || target===window || target===null)return window.scrollY||document.documentElement.scrollTop||0
    const el=target as HTMLElement
    // Only the page and the main content scroll the bar. Inner lists (chat, tables) do not.
    if(!el.classList)return null
    const bar=document.querySelector('.topbar')
    // The page scroller is whichever element holds the bar (or the content under it).
    if((bar && el.contains(bar)) || el.classList.contains('content') || el.classList.contains('workspaceContent'))return el.scrollTop
    return null
  }
  const apply=(y:number)=>{
    const next=nextIslandState(state,y)
    if(next!==state){
      state=next
      root.setAttribute('data-ra-island',state)
    }
  }
  const onScroll=(event:Event)=>{
    const y=read(event.target)
    if(y===null)return
    if(frame)return
    frame=window.requestAnimationFrame(()=>{frame=0;apply(y)})
  }
  const onTitle=(event:MouseEvent)=>{
    const hit=event.target as HTMLElement|null
    if(!hit || !hit.closest || !hit.closest('.topbarTitle'))return
    window.scrollTo({top:0,behavior:'smooth'})
  }
  document.addEventListener('scroll',onScroll,{capture:true,passive:true})
  document.addEventListener('click',onTitle)
  return()=>{
    document.removeEventListener('scroll',onScroll,true)
    document.removeEventListener('click',onTitle)
    if(frame)window.cancelAnimationFrame(frame)
    root.removeAttribute('data-ra-island')
  }
}
