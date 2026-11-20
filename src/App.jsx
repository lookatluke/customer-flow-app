import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, PARTY_TYPES } from './store'
import CanvasMap from './components/CanvasMap'
import Sidebar from './components/Sidebar'
import StatsPanel from './components/StatsPanel'

// ── [TEST HARNESS — opt-in, dev only] ────────────────────────────────
// When the URL contains ?demo=1 we auto-load a floor plan that is served
// same-origin and expose a window.__CF_DEMO__ helper that drives the whole
// customer journey through the REAL store actions. This exists ONLY so the
// app can be exercised end-to-end without the (hard-to-automate) macOS native
// file dialog. It never runs in normal use — the query param is never set.
const DEMO_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')
// ─────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    floorplanUrl, setFloorplan,
    parties, activePartyId,
    activeTab, setActiveTab,
    addParty, deleteParty,
    exportData, importData,
    toast, showToast,
    setActiveParty, updateParty, updateMember, setMemberCount,
    clearPath,
    // Mobile flow state
    flowStep, setFlowStep,
    selectedPartyId, setSelectedParty,
    sheetExpanded, toggleSheet,
    menuOpen, setMenuOpen,
    completeCurrentParty, startNewParty,
  } = useStore()

  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [mobileTab, setMobileTab] = useState('map')

  // ── Floorplan upload ──
  const handleFile = useCallback((f) => {
    if (!f?.type?.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      // If there are existing parties, this is a new floorplan (likely after
      // a refresh/reload where floorplanUrl was lost). Clear all parties
      // because their coordinates reference the old floorplan's image and
      // would show as ghost routes.
      const st = useStore.getState()
      if (st.parties.length > 0) {
        useStore.setState({
          parties: [],
          activePartyId: null,
          activeTool: 'draw',
          visiblePartyIds: [],
          flowStep: 'info',
          selectedPartyId: null,
          currentPath: [],
          drawing: false,
        })
      }
      setFloorplan(e.target.result)
      if (useStore.getState().flowStep === 'info') setFlowStep('path')
    }
    reader.readAsDataURL(f)
  }, [setFloorplan, setFlowStep])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }, [handleFile])

  const onFileChange = useCallback((e) => {
    handleFile(e.target.files?.[0]); e.target.value = ''
  }, [handleFile])

  // ── [TEST HARNESS — opt-in, dev only] Auto-load floor plan + expose a
  // driver that walks the real journey through the real store actions. ──
  useEffect(() => {
    if (!DEMO_MODE) return
    // Capture ANY uncaught error (incl. React render crashes) and show it
    // on-screen so a blank page is diagnosable from a screenshot.
    const onErr = (e) => {
      try {
        const msg = (e && e.error && e.error.stack) || e.message || String(e)
        window.__CF_RENDER_ERROR__ = msg
        let box = document.getElementById('cf-render-error')
        if (!box) {
          box = document.createElement('pre')
          box.id = 'cf-render-error'
          box.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#7f1d1d;color:#fff;padding:16px;font:13px monospace;white-space:pre-wrap;margin:0;overflow:auto;'
          document.body.appendChild(box)
        }
        box.textContent = 'RENDER ERROR:\n' + msg
      } catch {}
    }
    const onRej = (e) => { try { onErr({ message: 'PROMISE REJECTION: ' + (e.reason && e.reason.stack || e.reason) }) } catch {} }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    // ?fresh=1 → wipe persisted state so the demo starts from a clean slate.
    if (new URLSearchParams(location.search).has('fresh')) {
      try { localStorage.removeItem('customer-flow-v3') } catch {}
    }
    let cancelled = false
    // Load the same-origin floor plan (served by the local HTTP server).
    fetch('/test_floorplan.png')
      .then(r => r.blob())
      .then(blob => {
        if (cancelled) return
        const file = new File([blob], 'test_floorplan.png', { type: 'image/png' })
        handleFile(file)
        // Once the floor plan is in, expose the journey driver.
        const S = useStore.getState
        const delay = (ms) => new Promise(res => setTimeout(res, ms))
        window.__CF_DEMO__ = {
          // Register a customer and record a route + events for them,
          // using the SAME store actions the real canvas uses.
          async journey({ type = 'family', name = '가족', count = 3, points, events = [] }) {
            const S = useStore.getState
            const p = S().addParty({ type, name })
            S().setActiveParty(p)
            if (count && count > 1) S().setMemberCount(p, count)
            await delay(400)
            // Record route points (normalized 0-1).
            if (points?.length) {
              S().setActiveTool('draw')
              await delay(200)
              S().startDraw()
              for (const [x, y] of points) { S().addPathPoint(x, y); await delay(60) }
              S().endDraw()
            }
            // Record events — each is {x, y, type} using the real event type ids.
            if (events?.length) {
              S().setActiveTool('event')
              await delay(200)
              for (const ev of events) {
                S().setActiveEventType(ev.type || 'dwell')
                S().addEvent(ev.x, ev.y)
              }
              S().setActiveEventType('pass')
            }
            S().setActiveTool('draw')
            return p
          },
          setCount: (id, n) => useStore.getState().setMemberCount(id, n),
          toTab: (tab) => useStore.getState().setActiveTab(tab),
          complete: (id) => { useStore.getState().setActiveParty(id); useStore.getState().completeCurrentParty() },
          // Bridge to the LIVE zustand store so a test driver can call the REAL
          // draw actions (startDraw/addPathPoint/endDraw) to test append
          // semantics without going through journey().
          store: () => useStore,
          setVisible: (ids) => useStore.setState({ visiblePartyIds: ids }),
          state: () => JSON.parse(JSON.stringify(useStore.getState())),
        }
        window.__CF_STORE__ = useStore
        window.__CF_SET_VISIBLE__ = (ids) => useStore.setState({ visiblePartyIds: ids })
        window.__CF_DEMO__.ready = true
        window.dispatchEvent(new Event('cf-demo-ready'))

        // ── [TEST HARNESS — auto-run a full scenario so the journey can be
        // screenshotted end-to-end without any manual interaction.] ──
        // Coordinates are normalized (0-1) against the floor plan image.
        // Layout: ENTRANCE top-left, EXIT top-right, CHECKOUT bottom-right,
        // aisles across the middle. The scenario registers 3 customers,
        // records their routes + events through the REAL store actions,
        // completes them, and lands on the STATS tab.
        const runScenario = async () => {
          const stage = new URLSearchParams(location.search).get('stage') // 'map' | 'routes' | undefined(all)
          const stopAtStage = (name) => { if (stage === name) { document.title = 'CF-DEMO: STAGE-' + name.toUpperCase(); return true } return false }
          const step = (label) => { try { document.title = 'CF-DEMO: ' + label; window.__CF_LOG__ = (window.__CF_LOG__||[]).concat(label) } catch {} }
          try {
            const D = window.__CF_DEMO__
            const wait = (ms) => new Promise(res => setTimeout(res, ms))
            step('start')

          // STAGE 'map' stop: floor plan loaded, registration sidebar visible,
          // NO customers yet — the Stage-1 (customer registration) screenshot.
          if (stopAtStage('map')) {
            document.title = 'CF-DEMO: STAGE-MAP'
            return
          }

          // Customer 1 — family, 3 people, long browsing route ending at checkout.
          const p1 = await D.journey({
            type: 'family', name: '가족 A', count: 3,
            points: [[0.12, 0.12], [0.12, 0.45], [0.35, 0.50], [0.55, 0.42],
                     [0.62, 0.55], [0.72, 0.60], [0.85, 0.70], [0.88, 0.85]],
            events: [
              { x: 0.35, y: 0.50, type: 'dwell' },   // stopped in aisle
              { x: 0.62, y: 0.55, type: 'photo' },   // photographed a product
              { x: 0.72, y: 0.60, type: 'compare' }, // compared items
            ],
          })
          await wait(800)
          step('p1-done ' + p1)

          // Customer 2 — couple, 2 people, shorter route, touched a product.
          const p2 = await D.journey({
            type: 'couple', name: '커플 B', count: 2,
            points: [[0.10, 0.15], [0.25, 0.30], [0.40, 0.35], [0.55, 0.40],
                     [0.70, 0.45], [0.86, 0.60]],
            events: [
              { x: 0.40, y: 0.35, type: 'touch' },   // touched a product
              { x: 0.70, y: 0.45, type: 'dwell' },
            ],
          })
          await wait(800)
          step('p2-done ' + p2)

          // Customer 3 — solo, 1 person, quick pass-through.
          const p3 = await D.journey({
            type: 'solo', name: '개인 C', count: 1,
            points: [[0.11, 0.13], [0.30, 0.20], [0.50, 0.25], [0.75, 0.30], [0.87, 0.55]],
            events: [
              { x: 0.50, y: 0.25, type: 'pass' },
            ],
          })
          await wait(600)

          // STAGE 'routes' stop: all 3 customers registered AND routes drawn on the
          // map, but not yet completed and not on the stats tab — shows the live
          // drawing/registration state for a Stage-2 screenshot.
          if (stopAtStage('routes')) {
            useStore.setState({ visiblePartyIds: [p1, p2, p3] })
            return
          }

          // Mark all three as completed (as if the operator pressed 완료).
          D.complete(p1); await wait(400)
          step('complete-p1')
          D.complete(p2); await wait(400)
          step('complete-p2')
          D.complete(p3); await wait(400)
          step('complete-p3')

          // Show every party on the map, then jump to the STATS tab.
          useStore.setState({ visiblePartyIds: [p1, p2, p3] })
          step('visible-set')
          D.toTab('stats')
          step('toTab-stats')
          window.__CF_DEMO__.done = true
          window.dispatchEvent(new Event('cf-demo-done'))
          document.title = 'CF-DEMO: DONE'
          } catch (err) {
            // Surface any harness crash on-screen so it's visible in a screenshot.
            window.__CF_DEMO__.error = String(err && err.stack || err)
            const box = document.createElement('pre')
            box.id = 'cf-demo-error'
            box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;padding:12px;font:12px monospace;white-space:pre-wrap;margin:0;'
            box.textContent = 'DEMO HARNESS ERROR: ' + (err && err.stack || err)
            document.body.appendChild(box)
          }
        }
        // ── [BUG-FIX VERIFICATION] ─────────────────────────────────────────
        // Reproduce the exact reported bug through the SAME store actions the
        // canvas uses, then assert the fixes. Gated by ?verify=bugfix.
        // Writes a machine-readable result to window.__VERIFY__ + document.title.
        const runVerify = async () => {
          const S = useStore.getState
          const wait = (ms) => new Promise(res => setTimeout(res, ms))
          const R = { steps: [], pass: true }
          const log = (k, v) => { R.steps.push(k + '=' + v); try { document.title = 'CF-VERIFY: ' + k + '=' + v } catch {} }
          try {
            // 1) New customer (party).
            const pid = S().addParty({ type: 'solo', name: '검증' })
            S().setActiveParty(pid)
            S().setFlowStep('path')
            useStore.setState({ activeTool: 'draw' })
            log('party', pid)
            // 2) FIRST swipe (segment A) → endDraw commits.
            S().startDraw()
            for (const [x, y] of [[0.10, 0.15], [0.20, 0.30], [0.35, 0.40]]) { S().addPathPoint(x, y); await wait(30) }
            S().endDraw()
            let pathLen1 = S().parties.find(p => p.id === pid).path.length
            log('afterSwipe1', pathLen1)
            // 3) Select an event (event tool) + tap a dwell.
            useStore.setState({ activeTool: 'event' })
            S().setActiveEventType('dwell')
            S().addEvent(0.35, 0.40)
            await wait(60)
            // 4) SECOND swipe (segment B) on the SAME party → endDraw.
            //    BUG: this used to REPLACE path with B only. FIX: append A+B.
            useStore.setState({ activeTool: 'draw' })
            S().startDraw()
            for (const [x, y] of [[0.50, 0.50], [0.65, 0.55], [0.80, 0.65]]) { S().addPathPoint(x, y); await wait(30) }
            S().endDraw()
            const party = S().parties.find(p => p.id === pid)
            const pathLen2 = party.path.length
            const evCount = party.events.length
            log('afterSwipe2', pathLen2)
            log('events', evCount)
            // ASSERT 1 (Q1-b): the first swipe's points survived the event +
            // re-draw. Total path must be A(3) + B(3) = 6, NOT just B(3).
            const appendPass = pathLen2 === 6
            log('appendFix', appendPass ? 'PASS' : 'FAIL')
            R.append = { before: pathLen1, after: pathLen2, expect: 6, pass: appendPass }
            if (!appendPass) R.pass = false
            // ASSERT 2 (legacy): tapping "나감" (leave) still auto-completes the
            // party — kept as a data-path safety net even though 나감 is no
            // longer a visible event button.
            useStore.setState({ activeTool: 'event' })
            S().setActiveEventType('leave')
            S().addEvent(0.80, 0.65)
            await wait(600) // leave auto-complete is deferred ~250ms
            const after = S()
            const autoDone = after.flowStep === 'done'
            const completedAt = after.parties.find(p => p.id === pid).completedAt
            log('autoComplete', autoDone ? 'PASS' : 'FAIL')
            log('completedAt', completedAt ? 'YES' : 'NO')
            R.autoComplete = { flowStep: after.flowStep, completedAt: !!completedAt, pass: autoDone && !!completedAt }
            if (!(autoDone && completedAt)) R.pass = false

            // ASSERT 3 (UI): the DEDICATED "완료" button's action —
            // completeCurrentParty() — completes a fresh party + route.
            // (This is the path the new toolbar/floating button triggers.)
            const pid2 = S().addParty({ type: 'solo', name: '검증2' })
            S().setActiveParty(pid2)
            S().setFlowStep('path')
            useStore.setState({ activeTool: 'draw' })
            S().startDraw()
            for (const [x, y] of [[0.10, 0.15], [0.22, 0.28], [0.34, 0.38]]) { S().addPathPoint(x, y); await wait(30) }
            S().endDraw()
            // The dedicated button's handler is exactly completeCurrentParty().
            S().completeCurrentParty()
            await wait(50)
            const p2 = S().parties.find(p => p.id === pid2)
            const dedDone = S().flowStep === 'done' && !!p2.completedAt && p2.path.length === 3
            log('dedicatedComplete', dedDone ? 'PASS' : 'FAIL')
            R.dedicatedComplete = { flowStep: S().flowStep, completedAt: !!p2.completedAt, pathLen: p2.path.length, pass: dedDone }
            if (!dedDone) R.pass = false

            // ASSERT 4 (UI DOM): "나감" must NOT be a clickable event button
            // anymore, and a dedicated "완료" button must exist in the DOM.
            // First put a fresh party in the 'path' step with a route so the
            // dedicated complete button (which needs flowStep != 'done' and
            // path.length >= 2) actually renders.
            S().setFlowStep('path')
            useStore.setState({ activeTab: 'map' }) // ensure map toolbar is visible
            const pid3 = S().addParty({ type: 'solo', name: '검증3' })
            S().setActiveParty(pid3)
            useStore.setState({ activeTool: 'draw' })
            S().startDraw()
            for (const [x, y] of [[0.10, 0.15], [0.22, 0.28], [0.34, 0.38]]) { S().addPathPoint(x, y); await wait(30) }
            S().endDraw()
            await wait(80) // let React render the toolbar + floating button
            // 나감 appears as a chip label; confirm no chip/button carries it.
            const nagamButtons = [...document.querySelectorAll('button.chip')].filter(b => (b.textContent || '').includes('나감'))
            const nagamGone = nagamButtons.length === 0
            // A dedicated complete button exists (desktop .complete-btn or
            // mobile .floating-complete).
            const hasCompleteBtn = !!document.querySelector('.complete-btn') || !!document.querySelector('.floating-complete')
            log('nagamRemoved', nagamGone ? 'PASS' : 'FAIL(' + nagamButtons.length + ')')
            log('completeBtn', hasCompleteBtn ? 'PASS' : 'FAIL')
            R.ui = { nagamButtons: nagamButtons.length, nagamGone, hasCompleteBtn, pass: nagamGone && hasCompleteBtn }
            if (!(nagamGone && hasCompleteBtn)) R.pass = false

            window.__VERIFY__ = R
            document.title = 'CF-VERIFY: ' + (R.pass ? 'ALL-PASS' : 'FAIL')
            window.dispatchEvent(new Event('cf-verify-done'))
          } catch (err) {
            R.pass = false
            R.error = String(err && err.stack || err)
            window.__VERIFY__ = R
            document.title = 'CF-VERIFY: ERROR'
            try { const b = document.createElement('pre'); b.id = 'cf-verify-error'; b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;padding:12px;font:12px monospace;white-space:pre-wrap;margin:0;'; b.textContent = 'VERIFY ERROR: ' + (err && err.stack || err); document.body.appendChild(b) } catch {}
          }
        }
        // Run the scenario shortly after the floor plan settles.
        const verifyMode = new URLSearchParams(location.search).has('verify')
        if (verifyMode) {
          setTimeout(runVerify, 1200)
        } else {
          setTimeout(runScenario, 1200)
        }
        // ── end auto-run scenario ──────────────────────────────────────
      })
      .catch(err => { window.__CF_DEMO__ = { ready: false, error: String(err) } })
    return () => { cancelled = true }
  }, [handleFile])
  // ── end test harness ────────────────────────────────────────────────

  // ── Import/Export ──
  // Timestamped filename: customerflow_YYYYMMDD_HHMM.json
  // The date is in the filename so exports are date-grouped on disk.
  const stamp = () => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  }

  const doExport = useCallback(async () => {
    const json = exportData()
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const fname = `customerflow_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`
    // Prefer File System Access API: lets the user pick where to save.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        showToast(`💾 저장 완료: ${fname}`)
        setMenuOpen(false)
        return
      } catch (err) {
        if (err?.name === 'AbortError') { setMenuOpen(false); return }
        // fall through to anchor download
      }
    }
    // Fallback: anchor download to default Downloads folder
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fname
    a.click(); URL.revokeObjectURL(a.href)
    showToast(`💾 저장 완료: ${fname} → Downloads 폴더`)
    setMenuOpen(false)
  }, [exportData, showToast, setMenuOpen])

  const importInputRef = useRef(null)
  const doImport = useCallback(() => {
    importInputRef.current?.click()
    setMenuOpen(false)
  }, [setMenuOpen])

  const onImportFile = useCallback(async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try {
      const ok = importData(await f.text())
      showToast(ok ? `📂 가져오기 완료: ${f.name} (${useStore.getState().parties.length}명)` : '유효하지 않은 파일')
    } catch { showToast('파일 읽기 실패') }
  }, [importData, showToast])

  const doClearAll = useCallback(() => {
    if (parties.length === 0) return
    const proceed = window.confirm
      ? window.confirm(`모든 고객 데이터 (${parties.length}명)를 삭제할까요?`)
      : true
    if (!proceed) return
    useStore.setState({
      parties: [],
      activePartyId: null,
      activeTool: 'draw',
      visiblePartyIds: [],
      flowStep: 'info',
      selectedPartyId: null,
      currentPath: [],
      drawing: false,
    })
    showToast('🗑 모든 데이터가 삭제되었습니다')
    setMenuOpen(false)
  }, [parties.length, showToast, setMenuOpen])

  const handlePlanChange = useCallback((e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!f.type?.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      // New floorplan = new session. Clear all parties atomically so zustand
      // persist writes the empty state. Old parties reference the old
      // floorplan's coordinate system and would show as ghost routes.
      useStore.setState({
        parties: [],
        activePartyId: null,
        activeTool: 'draw',
        visiblePartyIds: [],
        flowStep: 'info',
        selectedPartyId: null,
        currentPath: [],
        drawing: false,
      })
      setFloorplan(ev.target.result)
      showToast('🔄 새 플랜 로드 — 이전 데이터 초기화')
    }
    reader.readAsDataURL(f)
  }, [setFloorplan, showToast])

  // ── Mobile flow helpers ──
  const activeParty = parties.find(p => p.id === activePartyId)
  const selectedParty = parties.find(p => p.id === (selectedPartyId || activePartyId))

  const startPathForParty = useCallback((partyId) => {
    const p = useStore.getState().parties.find(x => x.id === partyId)
    // Completed routes are locked: no re-entry into draw mode, no complete button.
    if (p && p.completedAt) {
      setFlowStep('done')
      setMobileTab('map')
      return
    }
    setActiveParty(partyId)
    setSelectedParty(partyId)
    setFlowStep('path')
    setMobileTab('map')
    useStore.setState({ activeTool: 'draw' })
  }, [setActiveParty, setSelectedParty, setFlowStep])

  // When the user clicks a party in the list, switch to it and set the
  // flow step appropriately. If the party already has a path, go to 'path'
  // (so the complete button appears). If not, go to 'info' so they can
  // fill in details first.
  const handleSelectParty = useCallback((partyId) => {
    const p = useStore.getState().parties.find(x => x.id === partyId)
    setActiveParty(partyId)
    setSelectedParty(partyId)
    // Completed parties: flowStep 'done' → map shows the completed banner and
    // no complete button; customer tab shows no "동선 그리기 시작" button.
    setFlowStep(p && p.completedAt ? 'done' : p && p.path.length >= 2 ? 'path' : 'info')
    setMobileTab('map')
  }, [setActiveParty, setSelectedParty, setFlowStep])

  const handleComplete = useCallback(() => {
    completeCurrentParty()
  }, [completeCurrentParty])

  const handleNewCustomer = useCallback(() => {
    startNewParty()
    setFlowStep('info')
  }, [startNewParty, setFlowStep])


  // ── No floorplan: upload prompt ──
  if (!floorplanUrl) {
    return (
      <div
        className={`drop-zone ${dragOver ? 'dragover' : ''}`}
        style={{ margin: 0, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 0 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />
        <div className="icon">🏪</div>
        <p><strong>매장 플랜 이미지</strong>를 끌어다 놓거나 클릭해서 선택하세요</p>
        <p className="sub">JPG · PNG · WebP</p>
      </div>
    )
  }

  // ── Render ──
  return (
    <>
      {/* ═══ DESKTOP ═══ */}
      <div className="desktop-layout">
        <div className="topbar">
          <div className="logo">🏪 <span>Customer</span> Flow</div>
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>매장 동선</button>
            <button className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>
              통계<span className="badge">{parties.length}</span>
            </button>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={() => fileInputRef.current?.click()}>플랜 변경</button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePlanChange} />
          <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
          <button className="btn" onClick={doImport}>가져오기</button>
          <button className="btn" onClick={doExport}>💾 저장 (전체)</button>
          <button className="btn danger" onClick={doClearAll} disabled={parties.length === 0}>전체 삭제</button>
        </div>
        <div className="main">
          {activeTab === 'map' && <CanvasMap />}
          {activeTab === 'map' ? <Sidebar /> : <StatsPanel />}
        </div>
      </div>

      {/* ═══ MOBILE ═══ */}
      <div className="mobile-layout">
        {/* Mobile topbar */}
        <div className="mobile-topbar">
          <div className="mt-logo">🏪 <span>Customer</span> Flow</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="mt-menu" onClick={() => fileInputRef.current?.click()}>🔄</button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePlanChange} />
            <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
            <button className="mt-menu" onClick={() => setMenuOpen(!menuOpen)}>⋮</button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {menuOpen && (
          <div className="mobile-menu-dropdown">
            <button className="btn" style={{ width: '100%', textAlign: 'left', margin: '2px 12px' }} onClick={doImport}>📂 불러오기</button>
            <button className="btn" style={{ width: '100%', textAlign: 'left', margin: '2px 12px' }} onClick={doExport}>💾 저장 (플랜 + 동선 전체)</button>
            <button className="btn danger" style={{ width: '100%', textAlign: 'left', margin: '2px 12px' }} onClick={doClearAll} disabled={parties.length === 0}>🗑 전체 삭제</button>
          </div>
        )}

        {/* Main content area */}
        <div className="mobile-main">
          {/* MAP TAB */}
          {mobileTab === 'map' && (
            <div className="mobile-map-wrap">
              <CanvasMap />
              {/* Bottom sheet */}
              {activeParty && flowStep === 'path' && (
                <div className={`mobile-sheet ${sheetExpanded ? 'expanded' : ''}`}>
                  <div className="mobile-sheet-header" onClick={toggleSheet}>
                    <span className="sheet-title">
                      {activeParty.name} · {activeParty.members.length}명 · {activeParty.path.length}개 동선
                    </span>
                    <span className="sheet-toggle">{sheetExpanded ? '▲ 접기' : '▼ 펼치기'}</span>
                  </div>
                  {sheetExpanded && (
                    <div className="mobile-sheet-body">
                      <div style={{ marginBottom: 12 }}>
                        <span className="form-label">구독 도구</span>
                        <div className="chip-row">
                          {['none', 'trolley', 'yellowbag'].map(t => (
                            <button
                              key={t}
                              className={`chip sm ${activeParty.shoppingTool === t ? 'active' : ''}`}
                              onClick={() => updateParty(activeParty.id, { shoppingTool: t })}
                            >
                              {t === 'none' ? '🚶 도보' : t === 'trolley' ? '🛒 트롤리' : '🟡 노랑봉투'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        className="btn"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={handleNewCustomer}
                      >
                        ➕ 새 고객 시작
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* Floating Complete Button — hidden for completed parties */}
              {activeParty && activeParty.path.length >= 2 && flowStep !== 'done' && !activeParty.completedAt && (
                <button className="floating-complete" onClick={handleComplete}>
                  ✓ 완료
                </button>
              )}
              {/* Done overlay */}
              {flowStep === 'done' && (
                <div 
                  className="flow-done-overlay"
                  onClick={() => {
                    // Close overlay and switch to customer tab
                    setFlowStep('idle')
                    setMobileTab('customers')
                  }}
                >
                  <div style={{ fontSize: 48 }}>✓</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>동선 완료!</div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>{activeParty?.name} 데이터가 저장되었습니다</div>
                  <div style={{ fontSize: 12, opacity: 0.5, marginTop: 16 }}>탭하면 닫힙니다</div>
                </div>
              )}
            </div>
          )}

          {/* CUSTOMERS TAB */}
          {mobileTab === 'customers' && (
            <div className="mobile-customer-tab visible">
              <div className="cust-header">
                <span className="cust-title">고객 정보</span>
                <button className="new-party-btn" onClick={handleNewCustomer}>
                  + 새 고객
                </button>
              </div>

              {parties.length > 0 && (
                <>
                  <div className="section-label">등록된 고객 ({parties.length})</div>
                  <div className="mobile-party-list">
                    {parties.map(p => (
                      <div
                        key={p.id}
                        className={`mobile-party-item ${selectedPartyId === p.id || activePartyId === p.id ? 'selected' : ''} ${p.completedAt ? 'completed' : ''}`}
                        onClick={() => handleSelectParty(p.id)}
                      >
                        <div className="mp-color" style={{ background: p.color }} />
                        <div className="mp-info">
                          <div className="mp-name">{p.name}</div>
                          <div className="mp-meta">{p.members.length}명 · {p.path.length}개 동선</div>
                        </div>
                        <div className="mp-actions">
                          {!p.completedAt && (
                            <button type="button" className="mp-btn" onClick={(e) => { e.stopPropagation(); startPathForParty(p.id) }}>동선</button>
                          )}
                          <span className="mp-completed-badge" title="완료됨">✓</span>
                          <button type="button" className="mp-btn delete" onClick={(e) => { e.stopPropagation(); deleteParty(p.id) }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Member form (vertical stack per Q4-a) */}
              {selectedParty && (
                <>
                  <div className="section-label">고객 구성</div>
                  {/* Party type (관계/유형) — the family/couple/friends/group selector */}
                  <div className="chip-row" style={{ marginBottom: 12, width: '100%' }}>
                    {PARTY_TYPES.map(t => (
                      <button
                        key={t.id}
                        className={`chip sm ${selectedParty.type === t.id ? 'active' : ''}`}
                        style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}
                        onClick={() => updateParty(selectedParty.id, { type: t.id })}
                      >
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="member-list">
                    {selectedParty.members.map((m, mi) => (
                      <div key={mi} className="member-row" style={{ flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                          <div className="member-idx">{mi + 1}</div>
                          <span className="slot-label" style={{ marginBottom: 0 }}>멤버 {mi + 1}</span>
                        </div>
                        {/* Gender — full width row */}
                        <div className="chip-row" style={{ width: '100%' }}>
                          {['m', 'f', 'none'].map(g => (
                            <button
                              key={g}
                              className={`chip sm ${g === 'm' ? 'g-m' : g === 'f' ? 'g-f' : ''} ${m.gender === g ? 'active' : ''}`}
                              onClick={() => updateMember(selectedParty.id, mi, { gender: g })}
                              style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}
                            >
                              {g === 'm' ? '♂ 남성' : g === 'f' ? '♀ 여성' : '○ 무관'}
                            </button>
                          ))}
                        </div>
                        {/* Age — full width row */}
                        <div style={{ display: 'flex', gap: 6, width: '100%', alignItems: 'center' }}>
                          <span className="slot-label" style={{ marginBottom: 0, minWidth: 40 }}>나이</span>
                          <div className="chip-row" style={{ flex: 1 }}>
                            {['a20', 'a30', 'a40', 'a50', 'a60'].map(a => (
                              <button
                                key={a}
                                className={`chip sm ${m.age === a ? 'active' : ''}`}
                                onClick={() => updateMember(selectedParty.id, mi, { age: a })}
                                style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}
                              >
                                {a.replace('a', '')}대
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Headcount stepper */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span className="slot-label" style={{ marginBottom: 0 }}>구성원 수</span>
                    <div className="stepper inline">
                      <button onClick={() => setMemberCount(selectedParty.id, Math.max(1, selectedParty.members.length - 1))}>−</button>
                      <span>{selectedParty.members.length}명</span>
                      <button onClick={() => setMemberCount(selectedParty.id, Math.min(8, selectedParty.members.length + 1))}>+</button>
                    </div>
                  </div>

                  {/* Shopping tool */}
                  <div>
                    <span className="slot-label" style={{ display: 'block', marginBottom: 6 }}>구독 도구</span>
                    <div className="chip-row">
                      {['none', 'trolley', 'yellowbag'].map(t => (
                        <button
                          key={t}
                          className={`chip sm ${selectedParty.shoppingTool === t ? 'active' : ''}`}
                          onClick={() => updateParty(selectedParty.id, { shoppingTool: t })}
                          style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}
                        >
                          {t === 'none' ? '🚶 도보' : t === 'trolley' ? '🛒 트롤리' : '🟡 노랑봉투'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* CTA: Start Path (hidden for completed parties — route is locked) */}
                  {!selectedParty.completedAt && (
                    <button
                      className="btn primary"
                      style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 15 }}
                      onClick={() => startPathForParty(selectedParty.id)}
                    >
                      ✏️ 동선 그리기 시작
                    </button>
                  )}
                  {selectedParty.completedAt && (
                    <div style={{ textAlign: 'center', padding: '10px', color: 'var(--text-muted)', fontSize: 14 }}>
                      ✓ 동선 완료 — 추가·수정 불가
                    </div>
                  )}
                </>
              )}

              {parties.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
                  <p>아직 등록된 고객이 없습니다.<br /><strong>+ 새 고객</strong>을 눌러 시작하세요.</p>
                </div>
              )}
            </div>
          )}

          {/* STATS TAB */}
          {mobileTab === 'stats' && (
            <div className="mobile-stats visible">
              <StatsPanel />
            </div>
          )}
        </div>

        {/* Bottom Tab Bar */}
        <div className="bottom-tabs">
          <button className={`bottom-tab ${mobileTab === 'map' ? 'active' : ''}`} onClick={() => setMobileTab('map')}>
            <span className="tab-icon">🗺</span>
            <span>지도</span>
          </button>
          <button className={`bottom-tab ${mobileTab === 'customers' ? 'active' : ''}`} onClick={() => setMobileTab('customers')}>
            <span className="tab-icon">👤</span>
            <span>고객</span>
          </button>
          <button className={`bottom-tab ${mobileTab === 'stats' ? 'active' : ''}`} onClick={() => setMobileTab('stats')}>
            <span className="tab-icon">📊</span>
            <span>통계</span>
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
