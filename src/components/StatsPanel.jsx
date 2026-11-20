import React, { useState, useCallback } from 'react'
import CanvasMap from './CanvasMap.jsx'
import {
  useStore, getEventType, getPartyType, EVENT_TYPES, PARTY_TYPES,
  AGE_BRACKETS, GENDERS, SHOPPING_TOOLS, headcountOf, slotLabel,
} from '../store.js'

// ── Stats ──────────────────────────────────────────────────────────────────
function computeStats(parties) {
  // 1. Total route stats
  const totalParties = parties.length
  const withPath = parties.filter(p => p.path.length > 0)
  const totalPoints = withPath.reduce((s, p) => s + p.path.length, 0)
  const totalEvents = parties.reduce((s, p) => s + p.events.length, 0)
  const avgPoints = withPath.length ? Math.round(totalPoints / withPath.length) : 0
  const avgEvents = totalParties ? Math.round(totalEvents / totalParties) : 0

  // 2. Group type distribution
  const typeDist = PARTY_TYPES.map(t => ({
    ...t,
    count: parties.filter(p => p.type === t.id).length,
  }))

  // 3. Total headcount (from members)
  const totalHeadcount = parties.reduce((s, p) => s + headcountOf(p), 0)

  // 4. Event type distribution
  const eventDist = EVENT_TYPES.map(et => ({
    ...et,
    count: parties.reduce((s, p) => s + p.events.filter(e => e.type === et.id).length, 0),
  }))

  // 5. Age distribution (per individual, 미상 included)
  const allMembers = parties.flatMap(p => p.members || [])
  const ageDist = [
    ...AGE_BRACKETS.map(a => ({ id: a.id, label: a.label })),
    { id: 'none', label: '미상' },
  ].map(a => ({
    ...a,
    count: allMembers.filter(m => (m.age || 'none') === a.id).length,
  }))

  // 6. Gender distribution — individual (per visitor) AND group level
  const genderIndividual = GENDERS.map(g => ({
    ...g,
    count: allMembers.filter(m => m.gender === g.id).length,
  }))
  const genderUnknown = allMembers.filter(m => !m.gender || m.gender === 'none').length
  // group level: a party "counts as" a gender if all its members are that gender
  const groupGender = { m: 0, f: 0, mixed: 0, none: 0 }
  parties.forEach(p => {
    const gs = (p.members || []).map(m => m.gender || 'none')
    if (gs.length === 0) { groupGender.none++; return }
    const unique = [...new Set(gs)]
    if (unique.length === 1) {
      if (unique[0] === 'm') groupGender.m++
      else if (unique[0] === 'f') groupGender.f++
      else groupGender.none++
    } else groupGender.mixed++
  })

  // 7. Shopping tool distribution
  const toolDist = SHOPPING_TOOLS.map(t => ({
    ...t,
    count: parties.filter(p => p.shoppingTool === t.id).length,
  }))

  // 8. Product touch zone heatmap
  const ZONES = 6
  const cellSize = 1 / ZONES
  const heatmap = Array.from({ length: ZONES }, () => Array.from({ length: ZONES }, () =>
    ({ touch: 0, photo: 0, dwell: 0, compare: 0, total: 0 })
  ))
  parties.forEach(p => {
    p.events.forEach(e => {
      const gx = Math.min(ZONES - 1, Math.floor(e.x / cellSize))
      const gy = Math.min(ZONES - 1, Math.floor(e.y / cellSize))
      const cell = heatmap[gy][gx]
      if (e.type === 'touch') cell.touch++
      else if (e.type === 'photo') cell.photo++
      else if (e.type === 'dwell') cell.dwell++
      else if (e.type === 'compare') cell.compare++
      cell.total++
    })
  })
  let maxHeat = 1
  heatmap.forEach(row => row.forEach(c => { if (c.total > maxHeat) maxHeat = c.total }))

  // 9. Path density heatmap
  const pathHeat = Array.from({ length: ZONES }, () => Array.from({ length: ZONES }, () => 0))
  parties.forEach(p => {
    p.path.forEach(pt => {
      const gx = Math.min(ZONES - 1, Math.floor(pt.x / cellSize))
      const gy = Math.min(ZONES - 1, Math.floor(pt.y / cellSize))
      pathHeat[gy][gx]++
    })
  })
  let maxPathHeat = 1
  pathHeat.forEach(row => row.forEach(v => { if (v > maxPathHeat) maxPathHeat = v }))

  return {
    totalParties, withPath, totalPoints, totalEvents, avgPoints, avgEvents,
    typeDist, totalHeadcount, eventDist,
    ageDist, genderIndividual, genderUnknown, groupGender, toolDist,
    heatmap, maxHeat, pathHeat, maxPathHeat, ZONES, cellSize,
  }
}

// ── Bar row helper ──
function BarRow({ label, count, total, color, icon, labelColor }) {
  const pct = total ? (count / total) * 100 : 0
  return (
    <div className="type-bar-row">
      <span className="type-label" style={labelColor ? { color: labelColor } : {}}>
        {icon ? `${icon} ` : ''}{label}
      </span>
      <div className="type-bar-track">
        <div className="type-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="type-count">{count}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function StatsPanel() {
  const { parties, floorplanUrl } = useStore()
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const s = computeStats(parties)

  const onRouteClick = useCallback((partyId) => {
    setSelectedRouteId(prev => {
      const next = prev === partyId ? null : partyId
      // Show only the selected route on the map (or all if none selected)
      useStore.setState({ visiblePartyIds: next ? [next] : parties.map(p => p.id) })
      return next
    })
  }, [parties])

  if (parties.length === 0) {
    return (
      <div className="stats-panel">
        <div className="stats-empty">
          <div className="icon">📊</div>
          <h3>통계 데이터가 없습니다</h3>
          <p>지도 탭에서 동선을 등록하면 통계를 볼 수 있습니다</p>
        </div>
      </div>
    )
  }

  return (
    <div className="stats-panel stats-with-map">
      {/* Left: read-only map overlay */}
      <div className="stats-map-side">
        <CanvasMap readOnly />
      </div>

      {/* Right: scrollable route list + stats */}
      <div className="stats-content">
      {/* Route list — top priority, compact, scrollable */}
      <div className="route-list-section">
        <h3 className="route-list-title">📋 고객 동선 <span className="route-count">{parties.length}명</span></h3>
        <div className="route-list">
          {parties.map((p, i) => (
            <div
              key={p.id}
              className={`route-item ${p.completedAt ? 'completed' : ''} ${selectedRouteId === p.id ? 'selected' : ''}`}
              onClick={() => onRouteClick(p.id)}
            >
              <span className="route-dot" style={{ background: p.color }} />
              <span className="route-name">{i + 1}. {getPartyType(p.type).icon} {p.name}</span>
              <span className="route-meta">
                {headcountOf(p)}명 · {p.path.length}점 · {p.events.length}이벤트
              </span>
              {p.completedAt && <span className="route-done">✓</span>}
            </div>
          ))}
        </div>
      </div>
      {/* Top KPI cards */}
      <div className="kpi-row">
        <KpiCard label="고객 동선" value={s.totalParties} sub={`${s.totalHeadcount}명 총 방문`} icon="🚶" color="#4f8ef7" />
        <KpiCard label="그려진 동선" value={s.withPath.length} sub={`평균 ${s.avgPoints}점`} icon="✏️" color="#34d399" />
        <KpiCard label="이벤트" value={s.totalEvents} sub={`동선당 ${s.avgEvents}개`} icon="📍" color="#fbbf24" />
        <KpiCard
          label="여성 비중"
          value={`${s.totalHeadcount ? Math.round((s.genderIndividual.find(g => g.id === 'f')?.count || 0) / s.totalHeadcount * 100) : 0}%`}
          sub={`여성 ${s.genderIndividual.find(g => g.id === 'f')?.count || 0}명 / 총 ${s.totalHeadcount}명`}
          icon="👩" color="#e879f9"
        />
      </div>

      <div className="stats-grid">
        {/* Group type distribution */}
        <div className="stats-card">
          <h3>👥 그룹 유형 분포</h3>
          <div className="type-bars">
            {s.typeDist.map(t => (
              <BarRow key={t.id} label={t.label} icon={t.icon} count={t.count} total={s.totalParties} color="var(--accent)" />
            ))}
          </div>
          <div className="type-summary">
            <span>총 방문 인원: <strong style={{ color: 'var(--accent)' }}>{s.totalHeadcount}명</strong></span>
          </div>
        </div>

        {/* Age distribution */}
        <div className="stats-card">
          <h3>🎂 연령대 분포 <span className="h3-sub">(방문객 기준)</span></h3>
          <div className="type-bars">
            {s.ageDist.map(a => (
              <BarRow key={a.id} label={a.label} count={a.count} total={s.totalHeadcount} color="#38bdf8" />
            ))}
          </div>
        </div>

        {/* Gender distribution — individual + group */}
        <div className="stats-card">
          <h3>⚧ 성별 분포</h3>
          <div className="type-bars">
            <div className="type-sub-label">개별 방문객 기준</div>
            {s.genderIndividual.map(g => (
              <BarRow key={g.id} label={g.label} icon={g.icon} count={g.count} total={s.totalHeadcount} color={g.id === 'm' ? '#38bdf8' : '#e879f9'} />
            ))}
            <BarRow label="미상" count={s.genderUnknown} total={s.totalHeadcount} color="#64748b" />
          </div>
          <div className="type-bars" style={{ marginTop: 10 }}>
            <div className="type-sub-label">그룹(동선) 기준</div>
            <BarRow label="남성 그룹" icon="👨" count={s.groupGender.m} total={s.totalParties} color="#38bdf8" />
            <BarRow label="여성 그룹" icon="👩" count={s.groupGender.f} total={s.totalParties} color="#e879f9" />
            <BarRow label="혼합" icon="👫" count={s.groupGender.mixed} total={s.totalParties} color="#a78bfa" />
            <BarRow label="미상" count={s.groupGender.none} total={s.totalParties} color="#64748b" />
          </div>
        </div>

        {/* Shopping tool distribution */}
        <div className="stats-card">
          <h3>🛒 쇼핑 도구 분포</h3>
          <div className="type-bars">
            {s.toolDist.map(t => (
              <BarRow key={t.id} label={t.label} icon={t.icon} count={t.count} total={s.totalParties} color="#fbbf24" />
            ))}
          </div>
        </div>

        {/* Event distribution */}
        <div className="stats-card">
          <h3>📍 이벤트 유형 분포</h3>
          <div className="event-bars">
            {s.eventDist.map(et => (
              <div key={et.id} className="event-bar-row">
                <span className="event-label" style={{ color: et.color }}>
                  {et.icon} {et.label}
                </span>
                <div className="event-bar-track">
                  <div
                    className="event-bar-fill"
                    style={{
                      width: s.totalEvents ? `${(et.count / s.totalEvents) * 100}%` : '0%',
                      background: et.color,
                    }}
                  />
                </div>
                <span className="event-count">{et.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Heatmap */}
        <div className="stats-card wide">
          <h3>🔥 열지도 (이벤트 집중도)</h3>
          <div className="heatmap-wrap">
            {floorplanUrl && (
              <img src={floorplanUrl} className="heatmap-bg" alt="" />
            )}
            <svg
              className="heatmap-svg"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {s.heatmap.map((row, y) =>
                row.map((cell, x) => {
                  const intensity = cell.total / s.maxHeat
                  if (cell.total === 0) return null
                  return (
                    <rect
                      key={`${x}-${y}`}
                      x={x * s.cellSize}
                      y={y * s.cellSize}
                      width={s.cellSize}
                      height={s.cellSize}
                      fill={intensity > 0.6 ? '#f87171' : intensity > 0.3 ? '#fbbf24' : '#34d399'}
                      opacity={0.15 + intensity * 0.55}
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={0.002}
                    >
                      <title>
                        터치 {cell.touch} · 사진 {cell.photo} · 멈춤 {cell.dwell} · 비교 {cell.compare}
                      </title>
                    </rect>
                  )
                })
              )}
            </svg>
            <div className="heatmap-legend">
              <span><i style={{ background: '#34d399' }} /> 낮음</span>
              <span><i style={{ background: '#fbbf24' }} /> 중간</span>
              <span><i style={{ background: '#f87171' }} /> 높음</span>
            </div>
          </div>
        </div>

        {/* Path density */}
        <div className="stats-card wide">
          <h3>🗺️ 동선 밀도</h3>
          <div className="heatmap-wrap">
            {floorplanUrl && (
              <img src={floorplanUrl} className="heatmap-bg" alt="" />
            )}
            <svg
              className="heatmap-svg"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {s.pathHeat.map((row, y) =>
                row.map((v, x) => {
                  const intensity = v / s.maxPathHeat
                  if (v === 0) return null
                  return (
                    <rect
                      key={`${x}-${y}`}
                      x={x * s.cellSize}
                      y={y * s.cellSize}
                      width={s.cellSize}
                      height={s.cellSize}
                      fill="#4f8ef7"
                      opacity={0.1 + intensity * 0.5}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={0.002}
                    />
                  )
                })
              )}
              {/* Draw all paths on top */}
              {parties.filter(p => p.path.length >= 2).map(p => (
                <path
                  key={p.id}
                  d={buildPathStr(p.path)}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={0.004}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.7}
                />
              ))}
            </svg>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────
function buildPathStr(points) {
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

function KpiCard({ label, value, sub, icon, color }) {
  return (
    <div className="kpi-card" style={{ borderTopColor: color }}>
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span className="kpi-value" style={{ color }}>{value}</span>
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}
