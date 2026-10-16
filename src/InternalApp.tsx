import App from './App'
import {RibbonGiftHost} from './components/WorkReactions'
import {RecognitionHost} from './components/Recognition'
import './styles.css'
import './brand.css'
import './workspace-shell.css'
import './chat.css'
import './virtual-card.css'

import './dark-shell.css'
import './appearance.css'
import './workflow.css'
import './theme-audit.css'
import './shell-stability.css'
import './runtime-stability.css'
import './workspace-nav.css'
import './responsive.css'
import './phone-shell.css'
import './liquid-glass.css'
import './app-feel.css'
import './nav-liquid.css'
import './theme-fixes.css'
import './island.css'
import './glass-clear.css'
import {useEffect} from 'react'
import {startIslandBar} from './lib/islandBar'


export default function InternalApp(){
  useEffect(()=>startIslandBar(),[])
  return <><App/><RibbonGiftHost/><RecognitionHost/></>
}
