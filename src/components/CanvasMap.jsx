import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useStore, getEventType, EDITABLE_EVENT_TYPES, getPartyType, headcountOf } from '../store.js'

const EventMarker = ({ ev, size = 9 }) => {
  const et = getEventType(ev.type)
  return (
    <g transform={`translate(${ev.x}, ${ev.y})`} style={{ cursor: 'pointer' }}>
      {/* r/widths are in viewBox units (0..1 = full map). Keep the stroke
          proportional to the radius — a fixed "1.5" here used to span the
          whole map and tint the entire floor plan. */}
      <circle r={size} fill={et.bg} stroke={et.color} strokeWidth={size * 0.25} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 1.1}
        fill={et.color}
        style={{ pointerEvents: 'none' }}
      >
        {et.icon}
      </text>
    </g>
  )
}

export default function CanvasMap() {
  const wrapRef = useRef(null)
  const imgRef = useRef(null)
  const svgRef = useRef(null)
  // Contain-fit box of the floorplan image inside .canvas-wrap. Both the
  // <img> and the <svg.overlay> are positioned to this exact box so 0..1 SVG
  // coordinates map 1:1 onto the image (no letterbox mismatch → paths align
  // with the plan in BOTH the map tab and the stats tab).
  const [fitBox, setFitBox] = useState(null) // {left, top, width, height}
  // Use a ref (not state) for `dragging` so the native touchmove handler can
  // read it synchronously on the very first move frame. A React state update
  // from touchstart would not have flushed by then, the handler would early-
  // return, preventDefault() would never run, and iOS would scroll/zoom the
  // page instead of letting us draw.
  const draggingRef = useRef(false)

  const {
    floorplanUrl,
    parties,
    activePartyId,
    activeTool,
    currentPath,
    drawing,
    visiblePartyIds,
    activeTab,
    addPathPoint,
    startDraw,
    endDraw,
    addEvent,
    setActiveTool,
    clearPath,
    showToast,
    completeCurrentParty,
    completeAndStartNext,
    flowStep,
  } = useStore()

  const activeParty = parties.find(p => p.id === activePartyId)

  // Read-only when: on the stats tab, OR the active party is already
  // completed. A completed route (completedAt set, or flowStep === 'done')
  // must not accept further path points or events — that was the bug where
  // "완료" was pressed but the user could still draw on the same route.
  const isCompleted = flowStep === 'done' || !!(activeParty && activeParty.completedAt)
  const readOnly = activeTab === 'stats' || isCompleted
  const label = activeParty
    ? `${getPartyType(activeParty.type).icon} ${activeParty.name} · ${headcountOf(activeParty)}명`
    : '고객 동선'

  // Coordinate conversion is driven by `fitBox` (the contain-fit box of the
  // floorplan inside .canvas-wrap), NOT by the live SVG rect. Before fitBox is
  // computed (image not loaded / ResizeObserver not fired yet) the SVG has no
  // explicit size and sits at the wrap's top-left (0,0) — reading its rect then
  // maps the first click to the top-left corner, producing the "line starts
  // from where I didn't click" bug. So: no fitBox → null → no drawing.
  // Convert a client (viewport) coordinate into 0..1 map space, OR return
  // null when the point falls OUTSIDE the floorplan image. We deliberately do
  // NOT clamp to 0..1: a mousedown/move in the letterbox margin (outside the
  // image) used to clamp to (0,0) — the top-left corner — and the next real
  // point then "jumped" to where the finger actually was, drawing the spurious
  // "line from the top-left I never started" segment. Dropping out-of-image
  // points instead means the stroke only ever contains points the user really
  // traced on the plan.
  const toSvgCoords = useCallback((clientX, clientY, overrideRect) => {
    if (!fitBox) return null
    const rect = overrideRect || (() => {
      const svg = wrapRef.current?.querySelector('svg.overlay')
      if (!svg) return null
      return svg.getBoundingClientRect()
    })()
    if (!rect || !rect.width || !rect.height) return null
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top) / rect.height
    // Strictly outside the image → not part of the route.
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }, [fitBox])

  const handleMouseDown = useCallback((e) => {
    if (readOnly) return
    if (e.button !== 0) return
    const p = toSvgCoords(e.clientX, e.clientY)
    if (!p) return
    if (activeTool === 'draw') {
      if (!drawing) {
        startDraw()
        addPathPoint(p.x, p.y)
      } else {
        addPathPoint(p.x, p.y)
      }
      draggingRef.current = true
    } else if (activeTool === 'event') {
      addEvent(p.x, p.y)
    }
  }, [readOnly, activeTool, drawing, toSvgCoords, startDraw, addPathPoint, addEvent])

  const handleMouseMove = useCallback((e) => {
    if (!draggingRef.current || activeTool !== 'draw') return
    const p = toSvgCoords(e.clientX, e.clientY)
    if (p) addPathPoint(p.x, p.y)
  }, [activeTool, toSvgCoords, addPathPoint])

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current) {
      endDraw()
      draggingRef.current = false
    }
  }, [endDraw])

  const handleDoubleClick = useCallback((e) => {
    if (activeTool !== 'draw' || !drawing) return
    const p = toSvgCoords(e.clientX, e.clientY)
    if (!p) return
    addPathPoint(p.x, p.y)
    endDraw()
    draggingRef.current = false
  }, [activeTool, drawing, toSvgCoords, addPathPoint, endDraw])

  // ── Compute the contain-fit box of the floorplan inside .canvas-wrap ──
  // Re-runs when the image loads (natural size known), when the floorplan
  // changes, and when the container resizes (ResizeObserver). This is what
  // keeps the SVG overlay perfectly registered over the image at any size.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !floorplanUrl) { setFitBox(null); return }

    const compute = () => {
      const wrapRect = wrap.getBoundingClientRect()
      const img = imgRef.current
      if (!wrapRect.width || !wrapRect.height) return
      // If the image hasn't finished loading, fall back to its rendered size.
      let nw = img ? img.naturalWidth : 0
      let nh = img ? img.naturalHeight : 0
      if (!nw || !nh) {
        // Image not ready yet; use the rendered box (CSS contain) as best effort.
        const r = img ? img.getBoundingClientRect() : null
        if (r && r.width && r.height) {
          setFitBox({
            left: r.left - wrapRect.left,
            top: r.top - wrapRect.top,
            width: r.width,
            height: r.height,
          })
        }
        return
      }
      const pad = 0.04 // same as CSS max-width/height 92%
      const availW = wrapRect.width * (1 - pad * 2)
      const availH = wrapRect.height * (1 - pad * 2)
      const scale = Math.min(availW / nw, availH / nh)
      const w = nw * scale
      const h = nh * scale
      setFitBox({
        left: (wrapRect.width - w) / 2,
        top: (wrapRect.height - h) / 2,
        width: w,
        height: h,
      })
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    const img = imgRef.current
    if (img && !img.complete) {
      img.onload = compute
      img.onerror = compute
    }
    return () => {
      ro.disconnect()
      if (imgRef.current) { imgRef.current.onload = null; imgRef.current.onerror = null }
    }
  }, [floorplanUrl])

  // ── Touch handlers ────────────────────────────────────────────────────
  // iOS WebKit (verified on real iPhone, Documents app):
  //  • preventDefault() MUST run before ANY touch-count / state gate. If it is
  //    skipped for even one frame, iOS WebKit claims the gesture for scroll/
  //    pinch and the finger trace dies → "tap one point per tap".
  //  • touches.length can momentarily read 2 on iOS during a normal one-finger
  //    drag, so we never bail out on it — we always preventDefault and keep
  //    drawing with the primary finger.
  //  • getBoundingClientRect() drifts the instant the page scrolls 1px, so we
  //    cache the rect at touchstart and reuse it for every move in the stroke.
  const strokeRef = useRef(null)   // { left, top, touchId }

  const handleTouchStart = useCallback((e) => {
    // Claim the gesture FIRST, unconditionally, so iOS can never scroll.
    e.preventDefault()
    if (readOnly) return
    const t = e.touches[0]
    if (!t) return
    // Use the live SVG rect so coords match the mouse handlers.
    const svg = wrapRef.current?.querySelector('svg.overlay')
    const rect = svg ? svg.getBoundingClientRect() : wrapRef.current.getBoundingClientRect()
    // Cache the full rect (with width/height) to avoid reflow on touchmove.
    strokeRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, touchId: t.identifier }
    const p = toSvgCoords(t.clientX, t.clientY, rect)
    if (!p) return
    if (activeTool === 'draw') {
      draggingRef.current = true
      if (!drawing) startDraw()
      addPathPoint(p.x, p.y)
    } else if (activeTool === 'event') {
      addEvent(p.x, p.y)
    }
  }, [readOnly, activeTool, drawing, toSvgCoords, startDraw, addPathPoint, addEvent])

  const handleTouchMove = useCallback((e) => {
    if (readOnly) return
    // preventDefault ALWAYS while a stroke is in progress — never let iOS
    // scroll mid-draw, regardless of touch count or tool.
    if (draggingRef.current) e.preventDefault()
    if (!draggingRef.current || activeTool !== 'draw') return
    // Follow the finger we started on; fall back to the first touch.
    let t = null
    for (let i = 0; i < e.touches.length; i++) {
      if (strokeRef.current && e.touches[i].identifier === strokeRef.current.touchId) {
        t = e.touches[i]; break
      }
    }
    if (!t) t = e.touches[0]
    if (!t) return
    // Use the cached full rect from touchstart (with width/height).
    const s = strokeRef.current
    const p = toSvgCoords(t.clientX, t.clientY, s)
    if (p) addPathPoint(p.x, p.y)
  }, [readOnly, activeTool, toSvgCoords, addPathPoint])

  const handleTouchEnd = useCallback((e) => {
    if (readOnly) return
    // Suppress the ghost mouse events that follow a touch.
    if (e.changedTouches && e.changedTouches.length === 1) e.preventDefault()
    if (draggingRef.current) {
      endDraw()
      draggingRef.current = false
      strokeRef.current = null
    }
  }, [readOnly, endDraw])

  // Attach touch handlers as NON-passive native listeners. React's
  // onTouchStart/Move/End are registered as passive by default, which makes
  // e.preventDefault() a no-op — the browser then scrolls/pinch-zooms the
  // page instead of letting us freehand-draw. Native {passive:false} restores
  // cancelability so finger tracing works on iOS/Android.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const opts = { passive: false }
    el.addEventListener('touchstart', handleTouchStart, opts)
    el.addEventListener('touchmove', handleTouchMove, opts)
    el.addEventListener('touchend', handleTouchEnd, opts)
    el.addEventListener('touchcancel', handleTouchEnd, opts)
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  const buildPathStr = (points) => {
    if (points.length < 2) return ''
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    return d
  }

  return (
    <div className="canvas-area">
      {/* ── Completed-route lock banner (shown only when the active party is
              done, not in the stats tab). Tells the user WHY drawing stopped. */}
      {isCompleted && activeTab !== 'stats' && activeParty && (
        <div className="canvas-toolbar completed-banner">
          <span className="completed-badge">
            ✓ {activeParty.name} 동선 완료
          </span>
          <span className="hint">
            완료된 동선은 수정할 수 없습니다. 새 동선을 추가하세요.
          </span>
        </div>
      )}
      {/* ── DESKTOP Toolbar (hidden in stats/read-only mode) ── */}
      {!readOnly && (
      <div className="canvas-toolbar">
        <button
          className={`btn ${activeTool === 'draw' ? 'active' : ''}`}
          onClick={() => setActiveTool('draw')}
          title="동선 그리기 (D)"
        >
          ✏️ 동선
        </button>
        <button
          className={`btn ${activeTool === 'event' ? 'active' : ''}`}
          onClick={() => setActiveTool('event')}
          title="이벤트 마커 (E)"
        >
          📍 이벤트
        </button>
        <div className="tool-sep" />
        {activeTool === 'event' && (
          <EventTypePicker />
        )}
        <div className="tool-sep" />
        {activeParty && activeParty.path.length > 0 && (
          <PathActions party={activeParty} />
        )}
        {/* Dedicated "완료" button — completes the active customer's route.
            Separate from the event pickers (나감 is no longer an event). */}
        {activeParty && activeParty.path.length >= 2 && flowStep !== 'done' && (
          <button
            className="btn complete-btn"
            onClick={completeAndStartNext}
            title="이 고객 동선 완료"
          >
            ✓ 완료
          </button>
        )}
        <span className="hint">
          {activeTool === 'draw' && '드래그로 동선 그림'}
          {activeTool === 'event' && '지도 위에서 탭해서 이벤트 기록'}
          {!activeParty && '⚠️ 오른쪽에서 동선을 먼저 추가하세요'}
        </span>
      </div>
      )}

      {/* ── MOBILE 2-Row Toolbar (hidden in stats/read-only mode) ── */}
      {!readOnly && (
      <div className="mobile-toolbar-row1">
        <button
          className={`btn ${activeTool === 'draw' ? 'active' : ''}`}
          onClick={() => setActiveTool('draw')}
        >
          ✏️ 동선
        </button>
        <button
          className={`btn ${activeTool === 'event' ? 'active' : ''}`}
          onClick={() => setActiveTool('event')}
        >
          📍 이벤트
        </button>
        {activeParty && activeParty.path.length > 0 && (
          <button
            className="btn trash-btn"
            onClick={() => { clearPath(); showToast('동선 삭제') }}
            title="동선 지우기"
          >
            🗑
          </button>
        )}
        <span className="hint-text">
          {activeTool === 'draw' ? '드래그로 동선' : '탭해서 이벤트'}
        </span>
      </div>
      )}
      {!readOnly && activeTool === 'event' && (
        <div className="mobile-toolbar-row2">
          {EDITABLE_EVENT_TYPES.map(et => (
            <button
              key={et.id}
              className={`chip ${useStore.getState().activeEventType === et.id ? 'active' : ''}`}
              onClick={() => useStore.getState().setActiveEventType(et.id)}
            >
              <span className="dot" style={{ background: et.color }} />
              {et.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Canvas ── */}
      <div
        className={`canvas-wrap${readOnly ? ' read-only' : ''}`}
        ref={wrapRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {floorplanUrl ? (
          <>
            {/* Desktop-only party filter chips (top-left overlay) — hidden in read-only mode */}
            {!readOnly && (
            <div className="party-filter-bar">
              <button
                className={`chip ${visiblePartyIds === null ? 'active' : ''}`}
                onClick={() => useStore.getState().resetPartyFilter()}
              >
                전체 ({parties.length})
              </button>
              {parties.map(p => (
                <button
                  key={p.id}
                  className={`chip ${visiblePartyIds !== null && visiblePartyIds.includes(p.id) ? 'active' : ''}`}
                  style={visiblePartyIds !== null && visiblePartyIds.includes(p.id) ? { background: p.color + '22', borderColor: p.color, color: p.color } : {}}
                  onClick={() => useStore.getState().togglePartyVisible(p.id)}
                >
                  <span className="dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
            )}
            <img
              ref={imgRef}
              className="floorplan"
              src={floorplanUrl}
              alt="Floor plan"
              draggable={false}
              style={fitBox ? {
                position: 'absolute',
                left: fitBox.left, top: fitBox.top,
                width: fitBox.width, height: fitBox.height,
                maxWidth: 'none', maxHeight: 'none',
                margin: 0, transform: 'none',
              } : {}}
            />
            <svg
              ref={svgRef}
              className={`overlay${drawing ? ' drawing' : ''}`}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={fitBox ? {
                position: 'absolute',
                left: fitBox.left, top: fitBox.top,
                width: fitBox.width, height: fitBox.height,
              } : {}}
            >
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="0.005" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* All party paths (filtered by visiblePartyIds) */}
              {parties.filter(p => visiblePartyIds === null || visiblePartyIds.includes(p.id)).map(p => (
                <g key={p.id} opacity={visiblePartyIds !== null && visiblePartyIds.length > 1 ? 0.8 : (p.id === activePartyId ? 1 : 0.35)}>
                  {p.path.length >= 2 && (
                    <path
                      d={buildPathStr(p.path)}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={0.004}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#glow)"
                      opacity={0.85}
                    />
                  )}
                  {/* Start marker */}
                  {p.path.length > 0 && (
                    <g transform={`translate(${p.path[0].x}, ${p.path[0].y})`}>
                      <circle r={0.012} fill={p.color} stroke="#fff" strokeWidth={0.002} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={0.02}
                        fill="#fff"
                        fontWeight="bold"
                        style={{ pointerEvents: 'none' }}
                      >
                        S
                      </text>
                    </g>
                  )}
                  {/* End marker */}
                  {p.path.length > 1 && (
                    <g transform={`translate(${p.path[p.path.length - 1].x}, ${p.path[p.path.length - 1].y})`}>
                      <circle r={0.012} fill={p.color} stroke="#fff" strokeWidth={0.002} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={0.02}
                        fill="#fff"
                        fontWeight="bold"
                        style={{ pointerEvents: 'none' }}
                      >
                        E
                      </text>
                    </g>
                  )}
                  {/* Party label near path start */}
                  {p.path.length > 0 && (
                    <g transform={`translate(${p.path[0].x + 0.02}, ${p.path[0].y - 0.015})`}>
                      <rect
                        x={0}
                        y={-0.018}
                        width={0.09}
                        height={0.036}
                        rx={0.006}
                        fill="rgba(0,0,0,0.7)"
                        stroke={p.color}
                        strokeWidth={0.002}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        x={0.045}
                        fontSize={0.018}
                        fill="#fff"
                        style={{ pointerEvents: 'none' }}
                      >
                        {getPartyType(p.type).icon} {headcountOf(p)}명 {(p.name || '').substring(0, 6)}
                      </text>
                    </g>
                  )}
                  {/* Event markers */}
                  {p.events.map(ev => (
                    <EventMarker key={ev.id} ev={ev} size={0.011} />
                  ))}
                </g>
              ))}

              {/* Current drawing path */}
              {currentPath.length >= 2 && (
                <path
                  d={buildPathStr(currentPath)}
                  fill="none"
                  stroke={activeParty?.color || '#4f8ef7'}
                  strokeWidth={0.005}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="0.01 0.008"
                  opacity={0.9}
                />
              )}
              {currentPath.length > 0 && (
                <g transform={`translate(${currentPath[0].x}, ${currentPath[0].y})`}>
                  <circle r={0.014} fill={activeParty?.color || '#4f8ef7'} stroke="#fff" strokeWidth={0.003} />
                </g>
              )}
            </svg>
          </>
        ) : (
          <div className="canvas-empty">
            <div className="icon">🗺️</div>
            <h3>방 지도를 업로드하세요</h3>
            <p>쇼룸 또는 매장 평면도를 JPG/PNG로 올려주세요</p>
            <UploadButton />
          </div>
        )}
      </div>
    </div>
  )
}

function UploadButton() {
  const inputRef = useRef(null)
  const { setFloorplan, showToast } = useStore()

  const handleFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setFloorplan(e.target.result)
      showToast('지도 업로드 완료!')
    }
    reader.readAsDataURL(file)
  }

  const [dragover, setDragover] = useState(false)

  return (
    <div
      className={`drop-zone ${dragover ? 'dragover' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
      onDragLeave={() => { e.preventDefault(); setDragover(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragover(false)
        handleFile(e.dataTransfer.files[0])
      }}
    >
      <div className="icon">📁</div>
      <p><strong>클릭하거나 드래그</strong>해서 지도 업로드</p>
      <p className="sub">JPG, PNG · 최대 10MB</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </div>
  )
}

function EventTypePicker() {
  const { activeEventType, setActiveEventType } = useStore()
  return (
    <div className="chip-row">
      {EDITABLE_EVENT_TYPES.map(et => (
        <button
          key={et.id}
          className={`chip ${activeEventType === et.id ? 'active' : ''}`}
          onClick={() => setActiveEventType(et.id)}
        >
          <span className="dot" style={{ background: et.color }} />
          {et.label}
        </button>
      ))}
    </div>
  )
}

function PathActions({ party }) {
  const { clearPath, showToast } = useStore()
  return (
    <>
      <button className="btn" onClick={() => { clearPath(); showToast('동선 삭제') }}>
        🗑 동선 지우기
      </button>
    </>
  )
}
