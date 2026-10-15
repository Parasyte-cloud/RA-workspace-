import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The entry script only decides which app to show, then loads that app's code,
// so the browser learns about the app's files one step late. This writes the
// names of the intranet app's files into the page so /preload-internal.js can
// start downloading them while the entry script is still arriving.
function internalAppPreload(): Plugin {
  return {
    name: 'internal-app-preload',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const app = Object.values(bundle).find(
          (item) => item.type === 'chunk' && /^assets\/InternalApp-/.test(item.fileName),
        )
        if (!app || app.type !== 'chunk') return html
        const files = [`/${app.fileName}`]
        for (const name of app.imports) files.push(`/${name}`)
        const css = (app.viteMetadata?.importedCss ?? new Set<string>()) as Set<string>
        const styles = Array.from(css).map((name) => `/${name}`)
        const tag =
          `<meta name="ra-preload" content="${files.join(',')}" data-css="${styles.join(',')}" />\n    <script src="/preload-internal.js"></script>`
        return html.replace('<script src="/recover.js">', `${tag}\n    <script src="/recover.js">`)
      },
    },
  }
}

export default defineConfig({ plugins: [react(), internalAppPreload()] })
