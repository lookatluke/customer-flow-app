import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// ── Standalone file:// fix ──────────────────────────────────────────────────
// iOS WKWebView and Android Chrome refuse to execute <script type="module">
// over file://. vite-plugin-singlefile already inlines JS + CSS into one HTML,
// so the bundle is otherwise a clean single file. The ONLY remaining change is
// to strip the module attributes so the inlined script runs as a classic
// (non-module) script. We do NOT move the <script> block — that approach
// caused corruption because `</body>` also appears inside the JS bundle.
// Instead, DOM-readiness is guaranteed in src/main.jsx (it waits for #root),
// so a classic script sitting in <head> is safe.
const stripModule = () => ({
  name: 'strip-module-attrs',
  apply: 'build',
  enforce: 'post',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        const asset = bundle[key]
        if (asset.type === 'asset' && key.endsWith('.html') && typeof asset.source === 'string') {
          asset.source = asset.source
            // Only the real inlined bundle tag has this exact form.
            .replace(/<script type="module" crossorigin>/g, '<script>')
            .replace(/<script type="module">/g, '<script>')
        }
      }
    },
  },
})

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), stripModule()],
})
