export type Tool = { name:string; area:string; purpose:string; url?:string; install?:string; mode:'native'|'embed'|'download'|'managed' }

export const engineeringTools: Tool[] = [
  { name:'VS Code', area:'Engineering', purpose:'Primary source-code editor', url:'https://code.visualstudio.com/', install:'brew install --cask visual-studio-code', mode:'download' },
  { name:'Git', area:'Engineering', purpose:'Version control CLI', url:'https://git-scm.com/', install:'brew install git', mode:'download' },
  { name:'GitHub CLI', area:'Engineering', purpose:'PR, issue and repository workflows from terminal', url:'https://cli.github.com/', install:'brew install gh', mode:'download' },
  { name:'Node.js LTS', area:'Engineering', purpose:'JavaScript runtime for web/backend tooling', url:'https://nodejs.org/', install:'brew install node', mode:'download' },
  { name:'Docker Desktop', area:'Engineering', purpose:'Containers and local services', url:'https://www.docker.com/products/docker-desktop/', install:'brew install --cask docker', mode:'download' },
  { name:'Postman', area:'Engineering', purpose:'API testing and collections', url:'https://www.postman.com/downloads/', install:'brew install --cask postman', mode:'download' },
  { name:'Android Studio', area:'Mobile', purpose:'Android SDK, emulators and native debugging', url:'https://developer.android.com/studio', install:'brew install --cask android-studio', mode:'download' },
  { name:'Xcode', area:'Mobile', purpose:'iOS builds, simulators and signing', url:'https://developer.apple.com/xcode/', mode:'managed' },
  { name:'Expo / EAS', area:'Mobile', purpose:'React Native development, builds and releases', url:'https://expo.dev/', install:'npm install -g eas-cli', mode:'download' },
  { name:'Cloudflare', area:'DevOps', purpose:'DNS, Pages, Workers and edge controls', url:'https://dash.cloudflare.com/', mode:'embed' },
  { name:'Vercel', area:'DevOps', purpose:'Frontend deployments and previews', url:'https://vercel.com/', mode:'embed' },
  { name:'Render', area:'DevOps', purpose:'Backend service hosting and logs', url:'https://render.com/', mode:'embed' },
  { name:'GitHub', area:'Engineering', purpose:'Repositories, pull requests, Actions and releases', url:'https://github.com/Parasyte-cloud', mode:'embed' }
]

export const supportTools: Tool[] = [
  { name:'Orders Console', area:'Support', purpose:'Incoming bookings, assignment status and rider context', mode:'native' },
  { name:'Live Trips', area:'Support', purpose:'Active ride monitoring, driver position and exceptions', mode:'native' },
  { name:'Panic Alerts', area:'Support', purpose:'Safety-critical alerts and escalation', mode:'native' },
  { name:'Rider Directory', area:'Support', purpose:'Rider profile, trip history and support context', mode:'native' },
  { name:'Driver Directory', area:'Support', purpose:'Driver verification, availability and support context', mode:'native' },
  { name:'Refunds & Disputes', area:'Support', purpose:'Payment exceptions and escalation workflow', mode:'native' }
]
