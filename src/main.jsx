import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Catches render crashes that would otherwise leave a black screen.
// Shows the actual error message instead of an empty <div id="root">.
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('[CustomerFlow] Render crash:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, fontFamily: 'system-ui, sans-serif',
          background: '#1a1a2e', color: '#f87171', minHeight: '100vh'
        }}>
          <h2 style={{ color: '#fff' }}>⚠️ 앱이 충돌했습니다</h2>
          <pre style={{
            background: '#0f0f1a', padding: 16, borderRadius: 8,
            fontSize: 13, whiteSpace: 'pre-wrap', color: '#fbbf24'
          }}>{this.state.error?.message || String(this.state.error)}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, padding: '10px 20px', fontSize: 14,
              background: '#4f8ef7', color: '#fff', border: 'none',
              borderRadius: 8, cursor: 'pointer'
            }}
          >
            새로고침
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
    <ErrorBoundary>
      <StrictMode>
        <App />
      </StrictMode>
    </ErrorBoundary>
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
