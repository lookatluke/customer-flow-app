import React, { useState, useEffect } from 'react'
import {
  useStore, PARTY_TYPES, PARTY_HEADCOUNT,
  AGE_BRACKETS, GENDERS, GENDER_UNKNOWN,
  SHOPPING_TOOLS, EDITABLE_EVENT_TYPES,
  getPartyType, getEventType, slotLabel, headcountOf,
} from '../store.js'

// ── Single member slot (for form) ──
function MemberSlot({ index, value, onChange }) {
  return (
    <div className="member-row">
      <span className="member-idx">{index + 1}</span>

      <div className="member-slot">
        <div className="slot-label">성별</div>
        <div className="chip-row tight">
          <button
            className={`chip sm ${(!value.gender || value.gender === 'none') ? 'active' : ''}`}
            onClick={() => onChange('gender', null)}
          >
            {GENDER_UNKNOWN.label}
          </button>
          {GENDERS.map(g => (
            <button
              key={g.id}
              className={`chip sm g-${g.id} ${value.gender === g.id ? 'active' : ''}`}
              onClick={() => onChange('gender', g.id)}
            >
              {g.icon} {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="member-slot">
        <div className="slot-label">나이대</div>
        <div className="chip-row tight">
          <button
            className={`chip sm ${(!value.age || value.age === 'none') ? 'active' : ''}`}
            onClick={() => onChange('age', null)}
          >
            미상
          </button>
          {AGE_BRACKETS.map(a => (
            <button
              key={a.id}
              className={`chip sm ${value.age === a.id ? 'active' : ''}`}
              onClick={() => onChange('age', a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── New party form ──
function PartyForm({ onAdd, onCancel }) {
  const [type, setType] = useState('solo')
  const [count, setCount] = useState(2)
  const [tool, setTool] = useState('none')
  const [memo, setMemo] = useState('')
  const [members, setMembers] = useState(
    Array.from({ length: PARTY_HEADCOUNT['solo'] }, () => ({ age: null, gender: null }))
  )

  const isSolo = type === 'solo'
  const effectiveCount = isSolo ? 1 : count

  // Sync members array length when type/count changes
  useEffect(() => {
    setMembers(prev => {
      const next = Array.from({ length: effectiveCount }, (_, i) => prev[i] || { age: null, gender: null })
      return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next
    })
  }, [effectiveCount])

  const updateMember = (idx, field, val) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m))
  }

  const add = () => {
    // Pad or trim members to match effectiveCount
    const finalMembers = Array.from({ length: effectiveCount }, (_, i) =>
      members[i] || { age: null, gender: null }
    )
    onAdd({ type, members: finalMembers, shoppingTool: tool, name: memo.trim() })
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div className="form-group">
        <label className="form-label">그룹 유형</label>
        <div className="chip-row">
          {PARTY_TYPES.map(pt => (
            <button
              key={pt.id}
              className={`chip ${type === pt.id ? 'active' : ''}`}
              onClick={() => { setType(pt.id); if (pt.id !== 'solo') setCount(PARTY_HEADCOUNT[pt.id]) }}
            >
              {pt.icon} {pt.label}
            </button>
          ))}
        </div>
      </div>

      {!isSolo && (
        <div className="form-group">
          <label className="form-label">인원 수</label>
          <div className="stepper">
            <button onClick={() => setCount(c => Math.max(2, c - 1))}>−</button>
            <span>{count}명</span>
            <button onClick={() => setCount(c => Math.min(20, c + 1))}>+</button>
          </div>
        </div>
      )}

      {/* Member slots — editable before creating */}
      <div className="form-group">
        <label className="form-label">방문객 정보 <span className="h3-sub">(선택)</span></label>
        <div className="member-list">
          {Array.from({ length: effectiveCount }, (_, i) => (
            <MemberSlot key={i} index={i} value={members[i] || { age: null, gender: null }} onChange={(field, val) => updateMember(i, field, val)} />
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">쇼핑 도구</label>
        <div className="chip-row">
          {SHOPPING_TOOLS.map(t => (
            <button
              key={t.id}
              className={`chip ${tool === t.id ? 'active' : ''}`}
              onClick={() => setTool(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">메모 (선택)</label>
        <input
          className="form-input"
          placeholder="예: 쇼룸 앞 테이블 근처"
          value={memo}
          onChange={e => setMemo(e.target.value)}
        />
      </div>

      <div className="form-actions">
        <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={add}>동선 만들기</button>
        {onCancel && <button className="btn" onClick={onCancel}>취소</button>}
      </div>
    </div>
  )
}

// ── Per-member slots (age + gender) ──
function MemberSlots({ party }) {
  const { updateMember, setMemberCount } = useStore()
  const isSolo = party.type === 'solo'

  return (
    <div className="form-group">
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>방문객 정보 <span style={{ color: 'var(--text-muted)' }}>({headcountOf(party)}명)</span></span>
        {!isSolo && (
          <span className="stepper" style={{ margin: 0 }}>
            <button onClick={() => setMemberCount(party.id, headcountOf(party) - 1)}>−</button>
            <span>{headcountOf(party)}명</span>
            <button onClick={() => setMemberCount(party.id, headcountOf(party) + 1)}>+</button>
          </span>
        )}
      </label>

      <div className="member-list">
        {party.members.map((m, i) => (
          <div key={i} className="member-row">
            <span className="member-idx">{i + 1}</span>

            <div className="member-slot">
              <div className="slot-label">성별</div>
              <div className="chip-row tight">
                <button
                  className={`chip sm ${m.gender === 'none' ? 'active' : ''}`}
                  onClick={() => updateMember(party.id, i, { gender: 'none' })}
                >
                  {GENDER_UNKNOWN.label}
                </button>
                {GENDERS.map(g => (
                  <button
                    key={g.id}
                    className={`chip sm g-${g.id} ${m.gender === g.id ? 'active' : ''}`}
                    onClick={() => updateMember(party.id, i, { gender: g.id })}
                  >
                    {g.icon} {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="member-slot">
              <div className="slot-label">나이대</div>
              <div className="chip-row tight">
                <button
                  className={`chip sm ${m.age === 'none' ? 'active' : ''}`}
                  onClick={() => updateMember(party.id, i, { age: 'none' })}
                >
                  미상
                </button>
                {AGE_BRACKETS.map(a => (
                  <button
                    key={a.id}
                    className={`chip sm ${m.age === a.id ? 'active' : ''}`}
                    onClick={() => updateMember(party.id, i, { age: a.id })}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Active party editor ──
function ActivePartyCard({ party }) {
  const {
    updateParty, deleteParty,
    activeEventType, setActiveEventType,
    removeEvent, showToast,
  } = useStore()

  const pt = getPartyType(party.type)
  const tc = SHOPPING_TOOLS.find(t => t.id === party.shoppingTool) || SHOPPING_TOOLS[0]

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${party.color || 'var(--accent)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="party-dot" style={{ background: party.color }} />
          <span style={{ fontWeight: 600, color: 'var(--text-h)', fontSize: 14 }}>{party.name}</span>
        </span>
        <button
          className="btn"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => { deleteParty(party.id); showToast('동선 삭제') }}
        >
          ✕ 삭제
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginBottom: 10 }}>
        <span><span style={{ color: 'var(--text-muted)' }}>유형 </span>{pt.icon} {pt.label}</span>
        <span><span style={{ color: 'var(--text-muted)' }}>도구 </span>{tc.icon} {tc.label}</span>
        <span><span style={{ color: 'var(--text-muted)' }}>동선 </span>{party.path.length}점 · {party.events.length}이벤트</span>
      </div>

      <MemberSlots party={party} />

      <div className="form-group">
        <label className="form-label">쇼핑 도구 (수정)</label>
        <div className="chip-row">
          {SHOPPING_TOOLS.map(t => (
            <button
              key={t.id}
              className={`chip ${party.shoppingTool === t.id ? 'active' : ''}`}
              onClick={() => updateParty(party.id, { shoppingTool: t.id })}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">이벤트 추가 (지도에 탭)</label>
        <div className="chip-row">
          {EDITABLE_EVENT_TYPES.map(e => (
            <button
              key={e.id}
              className={`chip ${activeEventType === e.id ? 'active' : ''}`}
              style={activeEventType === e.id ? { borderColor: e.color, color: e.color } : {}}
              onClick={() => setActiveEventType(e.id)}
            >
              {e.icon} {e.label}
            </button>
          ))}
        </div>
      </div>

      {party.events.length > 0 && (
        <div className="form-group">
          <label className="form-label">레코드된 이벤트</label>
          <div className="event-list">
            {party.events.map(ev => {
              const et = getEventType(ev.type)
              return (
                <div key={ev.id} className="event-item">
                  <span className="event-icon" style={{ background: et.bg, color: et.color }}>{et.icon}</span>
                  <span className="event-label">{et.label}</span>
                  <button className="del" onClick={() => removeEvent(party.id, ev.id)}>×</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const {
    parties, activePartyId,
    addParty, setActiveParty, showToast,
  } = useStore()

  const [showForm, setShowForm] = useState(parties.length === 0)
  const activeParty = parties.find(p => p.id === activePartyId)

  const handleAdd = (props) => {
    const id = addParty(props)
    setShowForm(false)
    showToast('동선 추가됨')
    return id
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>고객 동선 ({parties.length})</span>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>+ 동선</button>
        )}
      </div>
      <div className="sidebar-body">
        {showForm && (
          <PartyForm
            onAdd={handleAdd}
            onCancel={parties.length > 0 ? () => setShowForm(false) : undefined}
          />
        )}

        {activeParty && !showForm && (
          <ActivePartyCard party={activeParty} />
        )}

        <div style={{ marginTop: showForm || activeParty ? 16 : 0 }}>
          {parties.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🚶</div>
              <p>등록된 동선이 없습니다</p>
              <p style={{ fontSize: 12, opacity: 0.7 }}>+ 동선 버튼을 눌러 추가하세요</p>
            </div>
          ) : (
            parties.map(p => (
              <div
                key={p.id}
                className={`customer-item ${p.id === activePartyId ? 'active' : ''}`}
                onClick={() => setActiveParty(p.id)}
              >
                <div className="avatar" style={{ background: p.color || '#4f8ef7' }}>
                  {getPartyType(p.type).icon}
                </div>
                <div className="info">
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {getPartyType(p.type).label} · {headcountOf(p)}명 ·{' '}
                    {SHOPPING_TOOLS.find(t => t.id === p.shoppingTool)?.icon} {SHOPPING_TOOLS.find(t => t.id === p.shoppingTool)?.label}
                  </div>
                </div>
                <span
                  className="member-summary"
                  onClick={(e) => e.stopPropagation()}
                  title="방문객 요약"
                >
                  {p.members.map((m, i) => slotLabel(m)).filter(s => s !== '미상' || p.members.length === 1).join(' · ') || '미상'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
