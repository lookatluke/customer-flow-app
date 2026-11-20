import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The standalone bundle is inlined as a CLASSIC script (no type="module"), so
// it may execute before the <div id="root"> element exists (the script sits in
// <head>). Wait for the DOM to be ready before mounting. On iOS this module
// never executes (file:// JS is blocked), so #ios-guide stays visible — it is
// the only thing the iPhone user sees, and it explains how to open the file.
function boot() {
  // Remove the static iOS guide — we're running, so the app will render.
  const guide = document.getElementById('ios-guide')
  if (guide) guide.remove()

  const rootEl = document.getElementById('root')
  if (!rootEl) return // extremely defensive; should not happen

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
