// Minimal CDP client using Node's native WebSocket — no deps.
// Opens the Customer Flow page at a MOBILE viewport (390x780) and captures
// a full-page screenshot to prove the mobile-only "완료" floating button.
const http = require('http')
const fs = require('fs')

const CDP = 'http://localhost:9333'
const OUT = '/Users/luke/customer-flow/screenshots/ui_routes_mobile.png'
const URL = 'http://localhost:8917/?demo=1&fresh=1&stage=routes'

function getJson(path) {
  return new Promise((res, rej) => {
    // path like '/json/new?...' or '/json/close/<id>'
    const idx = path.indexOf('?')
    const pathname = idx === -1 ? path : path.slice(0, idx)
    const search = idx === -1 ? '' : path.slice(idx)
    const opts = { method: 'PUT', host: 'localhost', port: 9333, path: pathname + search }
    http.request(opts, (r) => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(new Error(d.slice(0, 200))) } })
    }).on('error', rej).end()
  })
}

// --- minimal CDP session over WebSocket ---
class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.id = 0; this.pending = new Map(); this.events = [] }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => res()
      this.ws.onerror = (e) => rej(new Error('ws error'))
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else resolve(msg.result)
        } else if (msg.method) {
          this.events.push(msg)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)) } }, 30000)
    })
  }
  close() { try { this.ws.close() } catch {} }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  // Create a NEW page target so we don't disturb Ego Lite's live tab.
  const target = await getJson('/json/new?' + encodeURIComponent(URL))
  console.log('TARGET keys:', Object.keys(target), 'ws:', target.webSocketDebuggerUrl)
  const wsUrl = target.webSocketDebuggerUrl
  if (!wsUrl) throw new Error('no wsUrl in target: ' + JSON.stringify(target).slice(0, 200))
  const cdp = new Cdp(wsUrl)
  await cdp.connect()

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')

  // Mobile device metrics: iPhone-like 390x780, deviceScaleFactor 3, mobile UA.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 780, deviceScaleFactor: 3, mobile: true
  })
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  })

  // Navigate fresh to the demo routes stage.
  await cdp.send('Page.navigate', { url: URL })

  // Wait for the demo to reach STAGE-ROUTES (title check via Runtime).
  let title = ''
  for (let i = 0; i < 40; i++) {
    await sleep(400)
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
      title = r.result && r.result.value
      if (title && title.indexOf('STAGE-ROUTES') !== -1) break
    } catch {}
  }
  console.log('TITLE:', title)

  // Also confirm the floating complete button + absence of 나감 chip via DOM.
  const dom = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      floatingComplete: !!document.querySelector('.floating-complete'),
      completeText: (document.querySelector('.floating-complete')||{}).textContent||'',
      chips: [...document.querySelectorAll('button.chip')].map(b=>b.textContent.trim()).filter(Boolean),
      nagamChip: [...document.querySelectorAll('button.chip')].some(b=>(b.textContent||'').includes('나감')),
      vw: window.innerWidth, vh: window.innerHeight
    })`,
    returnByValue: true
  })
  console.log('DOM:', dom.result && dom.result.value)

  await sleep(300)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', OUT)

  cdp.close()
  // Close the extra target (GET works for close).
  try {
    await new Promise((res) => {
      http.request({ method: 'GET', host: 'localhost', port: 9333, path: '/json/close/' + target.id }, (r) => { r.resume(); r.on('end', res) }).on('error', res).end()
    })
  } catch {}
  process.exit(0)
}

main().catch(e => { console.error('ERR', e.message); process.exit(1) })
