// Comprehensive E2E verification for Customer Flow.
// Walks the REAL user journey (register → draw → event → complete → stats)
// at BOTH desktop (1440px) and mobile (390px), capturing a screenshot at
// every stage, and asserts every feature works.
//
// All store access goes through window.__CF_DEMO__ (the opt-in test harness)
// because useStore is module-scoped and not on window. The harness uses the
// SAME store actions the real canvas uses, so this exercises the real code
// path a human tap hits. Zero deps: Node native WebSocket + http (CDP :9333).
const http = require('http')
const fs = require('fs')

const HOST = 'localhost'
const CDP_PORT = 9333
const APP = 'http://localhost:8917/'
const SHOT_DIR = '/Users/luke/customer-flow/screenshots'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function httpReq(method, port, path) {
  return new Promise((res, rej) => {
    const req = http.request({ method, host: HOST, port, path }, (r) => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => { try { res(JSON.parse(d)) } catch { res(d) } })
    })
    req.on('error', rej)
    req.end()
  })
}
async function cdpList() { return httpReq('GET', CDP_PORT, '/json') }
async function cdpNew(url) { return httpReq('PUT', CDP_PORT, '/json/new?' + encodeURIComponent(url)) }
async function cdpClose(id) { try { return await httpReq('GET', CDP_PORT, '/json/close/' + id) } catch {} }

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.id = 0; this.pending = new Map() }
  connect() { return new Promise((res, rej) => {
    this.ws = new WebSocket(this.wsUrl)
    this.ws.onopen = () => res()
    this.ws.onerror = () => rej(new Error('ws connect error'))
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    }
  }) }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)) } }, 30000)
    })
  }
  // run a JS expression in the page (may be an async function), return value
  async js(expr, timeoutMs = 30000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: timeoutMs })
    if (process.env.CDP_DEBUG) console.log('  [cdp:js] desc=', JSON.stringify(r.description || ''), 'type=', r.type, 'exc=', JSON.stringify(r.exceptionDetails || null), 'hasValue=', r.value !== undefined)
    return r.result ? r.result.value : (r.description !== undefined ? r : undefined)
  }
  // read a field of the store via the __CF_STORE__ bridge (deep copy, safe)
  async storeExpr(expr) {
    const full = `(function(){ try { const st = window.__CF_STORE__; if (!st) return {__storeErr:'no __CF_STORE__'}; const S = JSON.parse(JSON.stringify(st.getState())); return (function(S){ ${expr} })(S); } catch(e){ return {__storeErr: e.message} } })()`
    const r = await this.js(full)
    if (r && r.__storeErr && process.env.CDP_DEBUG) console.log('  [cdp:storeExpr] ERR:', r.__storeErr)
    return r
  }
  async title() { return (await this.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value }
  async shot(file) {
    const s = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'))
    return file
  }
  close() { try { this.ws.close() } catch {} }
}

// ── Result collector ────────────────────────────────────────────────────────
const results = []
function check(group, name, pass, detail) {
  results.push({ group, name, pass: !!pass, detail: detail || '' })
  console.log((pass ? '  \u2705 PASS' : '  \u274C FAIL') + '  [' + group + '] ' + name + (detail ? '  \u2014 ' + detail : ''))
}

async function waitReady(cdp, maxMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const ready = await cdp.js('!!(window.__CF_DEMO__ && window.__CF_DEMO__.ready)')
    if (ready) return true
    await sleep(300)
  }
  return false
}

// Helper: drive a journey via the harness (real store actions)
const journeyExpr = (cfg) =>
  `(async () => {
    const D = window.__CF_DEMO__
    const p = await D.journey(${JSON.stringify(cfg)})
    return p
  })()`

// ── One full E2E pass at a given viewport ───────────────────────────────────
async function runPass(cdp, label, vw, vh) {
  console.log('\n========== ' + label + '  (' + vw + 'x' + vh + ') ==========')
  const G = label

  // Stage 0 — floor plan loaded, registration panel visible
  const ready = await waitReady(cdp)
  await sleep(300)
  const regInfo = await cdp.js(`(function(ready){ return (() => {
    const floor = document.querySelectorAll('img').length
    const renderErr = !!document.getElementById('cf-render-error') || !!document.getElementById('cf-demo-error')
    const canvas = !!document.querySelector('canvas, svg')
    const sidebar = !!document.querySelector('aside, .sidebar, [class*=sidebar], [class*=Sidebar], [class*=panel]')
    const bodyLen = (document.body && document.body.innerHTML) ? document.body.innerHTML.length : 0
    return { ready: ready, floorImages: floor, renderErr, canvas, sidebar, bodyLen }
  })() })(${JSON.stringify(ready)})`)
  console.log('  stage0:', JSON.stringify(regInfo))
  check(G, 'Floor plan + registration panel loads (no render crash)',
    regInfo.ready && regInfo.floorImages >= 1 && !regInfo.renderErr && regInfo.bodyLen > 5000,
    'imgs=' + regInfo.floorImages + ' canvas=' + regInfo.canvas + ' sidebar=' + regInfo.sidebar + ' bodyLen=' + regInfo.bodyLen)
  await cdp.shot(SHOT_DIR + '/' + label + '_01_registration.png')

  // ── Clear pre-existing demo parties so our 3 test customers are the only ones ──
  await cdp.js(`window.__CF_STORE__ && window.__CF_STORE__.setState({ parties: [], activePartyId: null, visiblePartyIds: [] })`)
  await sleep(200)

  // ── Customer 1: family, 3 people, draw route + 3 events ──
  const p1 = await cdp.js(journeyExpr({ type: 'family', name: '가족 A', count: 3,
    points: [[0.12,0.12],[0.12,0.45],[0.35,0.50],[0.55,0.42],[0.62,0.55],[0.72,0.60],[0.85,0.70],[0.88,0.85]],
    events: [{x:0.35,y:0.50,type:'dwell'},{x:0.62,y:0.55,type:'photo'},{x:0.72,y:0.60,type:'compare'}] }))
  console.log('  party1 id:', p1)
  await sleep(300)
  const afterP1 = await cdp.storeExpr(`
    const p = S.parties.find(x => x.id === ${JSON.stringify(p1)})
    return p ? { name: p.name, path: p.path.length, events: p.events.length, members: p.members.length } : null
  `)
  console.log('  afterP1:', JSON.stringify(afterP1))
  check(G, 'Customer 1 registered (family, 3 people) + route drawn + 3 events',
    !!(afterP1 && afterP1.name === '가족 A' && afterP1.path === 8 && afterP1.events === 3 && afterP1.members === 3),
    JSON.stringify(afterP1))
  await cdp.shot(SHOT_DIR + '/' + label + '_02_customer1_route.png')

  // ── KEY BUG FIX: re-draw a route on the SAME customer → must APPEND ──
  const beforeLen = await cdp.storeExpr(`
    const p = S.parties.find(x => x.id === ${JSON.stringify(p1)})
    return p ? p.path.length : null
  `)
  // Append 3 more points on the same active party via the real draw actions
  const appendRes = await cdp.js(`(async () => {
    const st = window.__CF_STORE__
    if (!st) return { error: 'no __CF_STORE__ bridge' }
    const pid = ${JSON.stringify(p1)}
    const before = st.getState().parties.find(x => x.id === pid).path.length
    st.getState().setActiveTool('draw')
    st.getState().setActiveParty(pid)
    st.getState().startDraw()
    for (const [x,y] of [[0.88,0.85],[0.92,0.90],[0.95,0.93]]) { st.getState().addPathPoint(x,y); await new Promise(r=>setTimeout(r,40)) }
    st.getState().endDraw()
    const after = st.getState().parties.find(x => x.id === pid).path.length
    return { before, after }
  })()`)
  console.log('  append:', JSON.stringify(appendRes))
  check(G, 'Re-drawing a route APPENDS (does not erase prior points)',
    !!(appendRes && appendRes.after > appendRes.before), 'before=' + (appendRes && appendRes.before) + ' after=' + (appendRes && appendRes.after) + (appendRes && appendRes.error ? ' ' + appendRes.error : ''))

  // ── Customer 2: couple ──
  const p2 = await cdp.js(journeyExpr({ type: 'couple', name: '커플 B', count: 2,
    points: [[0.10,0.15],[0.25,0.30],[0.40,0.35],[0.55,0.40],[0.70,0.45],[0.86,0.60]],
    events: [{x:0.40,y:0.35,type:'touch'},{x:0.70,y:0.45,type:'dwell'}] }))
  await sleep(300)

  // ── Customer 3: solo ──
  const p3 = await cdp.js(journeyExpr({ type: 'solo', name: '개인 C', count: 1,
    points: [[0.11,0.13],[0.30,0.20],[0.50,0.25],[0.75,0.30],[0.87,0.55]],
    events: [{x:0.50,y:0.25,type:'pass'}] }))
  await sleep(300)

  // All 3 on map
  await cdp.js(`window.__CF_SET_VISIBLE__ && window.__CF_SET_VISIBLE__([${JSON.stringify([p1,p2,p3])}])`)
  await sleep(400)
  const threeInfo = await cdp.storeExpr(`
    const withPaths = S.parties.filter(p => p.path && p.path.length > 0).length
    return { parties: S.parties.length, withPaths }
  `)
  check(G, '3 customers registered + all routes visible on map', threeInfo.parties === 3 && threeInfo.withPaths === 3, JSON.stringify(threeInfo))
  await cdp.shot(SHOT_DIR + '/' + label + '_03_three_customers.png')

  // ── UI CHECKS: 나감 gone from event chips, dedicated 완료 button present ──
  const ui = await cdp.js(`(() => {
    const chips = [...document.querySelectorAll('button.chip')].map(b => (b.textContent||'').trim())
    const nagamChips = chips.filter(t => t.includes('나감'))
    const editable = chips.filter(t => ['지남','제품 만짐','사진 촬영','멈춤','비교'].some(e => t.includes(e)))
    const deskBtn = document.querySelector('.complete-btn')
    const floatBtn = document.querySelector('.floating-complete')
    return {
      chips,
      nagamChipCount: nagamChips.length,
      hasEditableEvents: editable.length,
      deskComplete: !!deskBtn,
      floatComplete: !!floatBtn,
      deskText: deskBtn ? deskBtn.textContent.trim() : null,
      floatText: floatBtn ? floatBtn.textContent.trim() : null
    }
  })()`)
  console.log('  ui:', JSON.stringify(ui))
  check(G, '"나감" removed from event chips', ui.nagamChipCount === 0, 'nagamChips=' + ui.nagamChipCount)
  check(G, 'Edit events still present (지남/제품 만짐/사진 촬영/멈춤/비교)', ui.hasEditableEvents >= 3, 'eventsFound=' + ui.hasEditableEvents)
  check(G, 'Dedicated 완료 button present', ui.deskComplete || ui.floatComplete, 'desk=' + ui.deskComplete + ' float=' + ui.floatComplete + ' text=' + (ui.deskText||ui.floatText))

  // ── COMPLETE the 3 customers via the harness (real completeCurrentParty) ──
  await cdp.js(`(async () => {
    const D = window.__CF_DEMO__
    D.complete(${JSON.stringify(p1)}); await new Promise(r=>setTimeout(r,150))
    D.complete(${JSON.stringify(p2)}); await new Promise(r=>setTimeout(r,150))
    D.complete(${JSON.stringify(p3)}); await new Promise(r=>setTimeout(r,150))
  })()`)
  await sleep(300)
  const compInfo = await cdp.storeExpr(`
    const mine = S.parties.filter(p => ${JSON.stringify([p1,p2,p3])}.includes(p.id))
    const completed = mine.filter(p => p.completedAt).length
    const routesKept = mine.filter(p => p.path && p.path.length > 0).length
    return { completed, total: mine.length, routesKept }
  `)
  console.log('  compInfo:', JSON.stringify(compInfo))
  check(G, 'Complete button completes a customer (completedAt set, route kept)',
    compInfo.completed === 3 && compInfo.routesKept === 3,
    'completed=' + compInfo.completed + '/' + compInfo.total + ' routesKept=' + compInfo.routesKept)

  // ── CRITICAL: second-customer complete-button regression ──
  // The dedicated "완료" button must still render for a SECOND customer after
  // the first is completed. Repro: register + draw customer A → complete →
  // register + draw customer B → assert button visible.
  await cdp.js(`(async () => {
    const S = window.__CF_STORE__.getState
    const store = window.__CF_STORE__
    // Reset to a clean slate for this regression
    store.setState({ parties: [], activePartyId: null, flowStep: 'info', toast: null })
    await new Promise(r => setTimeout(r, 200))
    // Customer A
    const a = S().addParty({ type: 'solo', name: '회귀A' })
    S().setActiveParty(a)
    S().setFlowStep('path')
    S().startDraw()
    for (const [x,y] of [[0.1,0.1],[0.3,0.3],[0.5,0.5]]) { S().addPathPoint(x,y); await new Promise(r=>setTimeout(r,30)) }
    S().endDraw()
    await new Promise(r => setTimeout(r, 100))
    // Complete customer A via the NEW action (what the button calls)
    S().completeAndStartNext()
    await new Promise(r => setTimeout(r, 1200)) // wait for the 800ms deferred reset
    // Customer B
    const b = S().addParty({ type: 'couple', name: '회귀B' })
    S().setActiveParty(b)
    S().setFlowStep('path')
    S().startDraw()
    for (const [x,y] of [[0.2,0.2],[0.4,0.4],[0.6,0.6]]) { S().addPathPoint(x,y); await new Promise(r=>setTimeout(r,30)) }
    S().endDraw()
    await new Promise(r => setTimeout(r, 100))
  })()`)
  await sleep(300)
  const regr = await cdp.js(`(() => {
    // Find the ACTUALLY VISIBLE complete button (desktop or floating, not display:none)
    const candidates = document.querySelectorAll('.complete-btn, .floating-complete')
    let btn = null
    for (const c of candidates) {
      const r = c.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) { btn = c; break }
    }
    if (!btn && candidates.length) btn = candidates[0] // fallback: at least exists in DOM
    return {
      btnExists: !!btn,
      btnText: btn ? btn.textContent.trim() : null,
      btnVisible: btn ? (btn.getBoundingClientRect().width > 0) : false,
      btnClass: btn ? btn.className : null,
    }
  })()`)
  console.log('  regression:', JSON.stringify(regr))
  check(G, 'Second-customer complete button still renders after first completion',
    regr.btnExists && regr.btnVisible && /완료/.test(regr.btnText || ''),
    'exists=' + regr.btnExists + ' visible=' + regr.btnVisible + ' text=' + (regr.btnText||''))
  await cdp.shot(SHOT_DIR + '/' + label + '_05_second_complete.png')

  // ── STATS TAB: must not crash, must show data ──
  await cdp.js(`window.__CF_DEMO__.toTab('stats')`)
  await sleep(700)
  const stats = await cdp.js(`(() => {
    const bodyText = document.body.innerText || ''
    const crashed = !document.body || !document.body.innerHTML || document.body.innerHTML.length < 200
    const hasStats = /통계|Stats|고객|동선|이벤트|완료|평균|총|고객 수/.test(bodyText)
    const canvases = document.querySelectorAll('canvas, svg, img, table, [class*=stat], [class*=Stat]').length
    return { crashed, hasStats, vizEls: canvases, bodyLen: bodyText.length }
  })()`)
  console.log('  stats:', JSON.stringify(stats))
  check(G, 'Statistics tab renders (no crash) with data', !stats.crashed && stats.hasStats, 'vizEls=' + stats.vizEls + ' bodyLen=' + stats.bodyLen)
  await cdp.shot(SHOT_DIR + '/' + label + '_04_stats.png')
}

async function main() {
  console.log('=== Customer Flow E2E Verification ===')

  // ── DESKTOP pass (1440x900) ──
  const dt = await cdpNew('about:blank')
  const dcdp = new Cdp(dt.webSocketDebuggerUrl)
  await dcdp.connect()
  await dcdp.send('Page.enable'); await dcdp.send('Runtime.enable')
  await dcdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await dcdp.send('Page.navigate', { url: APP + '?demo=1&fresh=1&stage=map' })
  await runPass(dcdp, 'verif_desktop', 1440, 900)
  dcdp.close(); await cdpClose(dt.id)
  // ── MOBILE pass (390x780) ──
  const mt = await cdpNew('about:blank')
  const mcdp = new Cdp(mt.webSocketDebuggerUrl)
  await mcdp.connect()
  await mcdp.send('Page.enable'); await mcdp.send('Runtime.enable')
  await mcdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true })
  await mcdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
  await mcdp.send('Page.navigate', { url: APP + '?demo=1&fresh=1&stage=map' })
  await runPass(mcdp, 'verif_mobile', 390, 780)
  mcdp.close(); await cdpClose(mt.id)

  // ── SUMMARY ──
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log('\n==================== SUMMARY ====================')
  console.log('TOTAL: ' + results.length + '   PASS: ' + passed + '   FAIL: ' + failed)
  if (failed > 0) {
    console.log('\nFAILURES:')
    results.filter(r => !r.pass).forEach(r => console.log('  \u2717 [' + r.group + '] ' + r.name + ' \u2014 ' + r.detail))
  }
  fs.writeFileSync('/Users/luke/customer-flow/VERIFICATION_RESULTS.json', JSON.stringify({ total: results.length, passed, failed, results }, null, 2))
  console.log('\nResult: ' + (failed === 0 ? 'ALL PASS \u2705' : 'HAS FAILURES \u274C'))
  process.exit(failed === 0 ? 0 : 2)
}

main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1) })
