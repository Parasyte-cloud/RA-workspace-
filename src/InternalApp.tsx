import App from './App'
import {RibbonGiftHost} from './components/WorkReactions'
import {RecognitionHost} from './components/Recognition'
import {ParasyteCrestBar,ParasyteSplash} from './components/ParasyteCrest'
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
import './visibility-fixes.css'
import './secondary-button.css'
import './dark-readability.css'
import './parasyte-crest.css'
import {useEffect} from 'react'
import {startIslandBar} from './lib/islandBar'
import {startIslandMotion} from './lib/islandMotion'


export default function InternalApp(){
  useEffect(()=>startIslandBar(),[])
  useEffect(()=>startIslandMotion(),[])
  return <><App/><RibbonGiftHost/><RecognitionHost/><ParasyteCrestBar/><ParasyteSplash/></>
}
