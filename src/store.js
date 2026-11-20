import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Constants ──────────────────────────────────────────────────────────────
export const PARTY_TYPES = [
  { id: 'solo',    label: '혼자',   icon: '👤' },
  { id: 'couple',  label: '커플/부부', icon: '💑' },
  { id: 'friends', label: '친구',   icon: '👥' },
  { id: 'family',  label: '가족',   icon: '👨‍👩‍👧' },
  { id: 'group',   label: '단체',   icon: '👨‍👩‍👧‍👦' },
]

// Headcount defaults per type. solo = 1. Everything else STARTS at 2
// (a couple/friends/family/group always has at least two people); the user
// can then raise the count with the +/– stepper in the customer form.
export const PARTY_HEADCOUNT = { solo: 1, couple: 2, friends: 2, family: 2, group: 2 }

export const AGE_BRACKETS = [
  { id: 'a10', label: '10대' },
  { id: 'a20', label: '20대' },
  { id: 'a30', label: '30대' },
  { id: 'a40', label: '40대' },
  { id: 'a50', label: '50대' },
  { id: 'a60', label: '60대+' },
]
export const AGE_UNKNOWN = { id: 'none', label: '미상' }

export const GENDERS = [
  { id: 'm', label: '남', icon: '♂' },
  { id: 'f', label: '여', icon: '♀' },
]
export const GENDER_UNKNOWN = { id: 'none', label: '미상', icon: '·' }

export const SHOPPING_TOOLS = [
  { id: 'none',    label: '없음',     icon: '✋' },
  { id: 'trolley', label: '트롤리',   icon: '🛒' },
  { id: 'yellowbag', label: '엘로우 백', icon: '🛍' },
]

export const EVENT_TYPES = [
  { id: 'pass',     label: '지남',       icon: '→',  color: '#7a8494', bg: 'rgba(122,132,148,0.15)' },
  { id: 'touch',    label: '제품 만짐',  icon: '✋', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  { id: 'photo',    label: '사진 촬영',  icon: '📷', color: '#4f8ef7', bg: 'rgba(79,142,247,0.15)' },
  { id: 'dwell',    label: '멈춤/관심',  icon: '⏸', color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
  { id: 'compare',  label: '비교/검토',  icon: '🔍', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  { id: 'leave',    label: '나감',       icon: '🚪', color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
]

export const getPartyType = (id) => PARTY_TYPES.find(p => p.id === id) || PARTY_TYPES[0]
export const getShoppingTool = (id) => SHOPPING_TOOLS.find(t => t.id === id) || SHOPPING_TOOLS[0]
export const getEventType = (id) => EVENT_TYPES.find(e => e.id === id) || EVENT_TYPES[0]

// Event types the user can actively pick in the toolbar/sidebar.
// 'leave' (나감) is NOT an interactive event anymore — completing a route is a
// dedicated "완료" action, not an event marker. 'leave' is still kept in
// EVENT_TYPES for data/stats/demo/export and the legacy auto-complete hook.
export const EDITABLE_EVENT_TYPES = EVENT_TYPES.filter(e => e.id !== 'leave')
export const getAgeLabel = (id) => (AGE_BRACKETS.find(a => a.id === id) || AGE_UNKNOWN).label
export const getGender = (id) => GENDERS.find(g => g.id === id) || null

// Compact slot label: e.g. "여30" / "남30" / "미상"
export const slotLabel = (m) => {
  if (!m) return '미상'
  const g = getGender(m.gender)
  const a = getAgeLabel(m.age)
  if (!g && a === '미상') return '미상'
  return `${g ? g.label : '미상'}${a === '미상' ? '' : a}`
}

// ── Store ──────────────────────────────────────────────────────────────────
let nextPartyId = 1
let nextEventId = 1

const makeMember = (m = {}) => ({
  age: m.age || 'none',
  gender: m.gender || 'none',
})

const defaultMembers = (type) => {
  const n = type === 'solo' ? 1 : (PARTY_HEADCOUNT[type] || 1)
  return Array.from({ length: n }, () => makeMember())
}

const makeParty = (props = {}) => ({
  id: `p${nextPartyId++}`,
  name: props.name || '',
  type: props.type || 'solo',
  members: props.members?.length ? props.members : defaultMembers(props.type || 'solo'),
  shoppingTool: props.shoppingTool || 'none',
  path: [],       // [{x, y}] normalized 0-1
  completedAt: null, // ISO timestamp — set when "완료" is pressed
  events: [],     // [{id, type, x, y, ts}]
  color: props.color,
})

// Helper: add a new party (used by both addParty and startNewParty)
const addPartyImpl = (set, get) => {
  const parties = get().parties
  const p = makeParty({ type: 'solo' })
  p.color = assignPathColor(parties.length)
  p.name = `동선 ${parties.length + 1}`
  const flowStep = get().flowStep === 'done' ? 'info' : get().flowStep
  set({
    parties: [...parties, p],
    activePartyId: p.id,
    flowStep,
    // A brand-new party must be VISIBLE. If the desktop filter (visiblePartyIds)
    // was pinned to a specific earlier party, the new one would be hidden and
    // the user would see "I drew a route but it's not on the map". Resetting
    // to null (= show all) guarantees the new route shows immediately.
    visiblePartyIds: null,
  })
  return p.id
}

export const headcountOf = (p) => p.members?.length || (p.headcount || 1)

const assignPathColor = (idx) => {
  const palette = ['#4f8ef7', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#f87171', '#fb923c', '#84cc16', '#e879f9']
  return palette[idx % palette.length]
}

// Rebuild member slots when headcount/type changes, preserving existing entries
const syncMembers = (party, type, count) => {
  const n = type === 'solo' ? 1 : count
  const existing = party.members || []
  return Array.from({ length: n }, (_, i) => existing[i] || makeMember())
}

// True when the currently-active party is already completed (completedAt set).
// Used to lock a finished route so no more path points / events can be added.
const activeIsCompleted = (get) => {
  const { activePartyId, parties } = get()
  const p = parties.find(pp => pp.id === activePartyId)
  return !!(p && p.completedAt)
}

export const useStore = create(persist((set, get) => ({
  // ── State ──
  floorplanUrl: null,
  parties: [],
  activePartyId: null,
  activeTool: 'draw',
  activeEventType: 'pass',
  activeTab: 'map',
  drawing: false,
  currentPath: [],
  toast: null,
  visiblePartyIds: null, // null = show all parties; array = show only listed ids (desktop filter)

  // ── Floor plan ──
  setFloorplan: (url) => set({
    floorplanUrl: url,
    // New floor plan: clear ALL paths/events/completedAt from ALL parties.
    // Old coordinates are meaningless on a different image.
    parties: get().parties.map(p => ({ ...p, path: [], events: [], completedAt: null })),
    activePartyId: null,
    currentPath: [],
    drawing: false,
    flowStep: 'customer',
    selectedPartyId: null,
  }),
  clearFloorplan: () => set({ floorplanUrl: null }),

  // ── Parties ──
  addParty: (props) => {
    const parties = get().parties
    const p = makeParty(props)
    p.color = assignPathColor(parties.length)
    if (!p.name) p.name = `동선 ${parties.length + 1}`
    // A new party has no path yet, so the flow step must be 'info' (the
    // customer-info form) — never 'done' (left over from a previously
    // completed party). This is the bug that hid the "완료" button after
    // completing one party and starting a second.
    const flowStep = get().flowStep === 'done' ? 'info' : get().flowStep
    set({
      parties: [...parties, p],
      activePartyId: p.id,
      flowStep,
      // New party must be visible — reset the desktop filter to "show all" so
      // the fresh route isn't hidden behind a stale per-party selection.
      visiblePartyIds: null,
    })
    return p.id
  },

  // Mobile flow: start a fresh party for the next customer
  startNewParty: () => addPartyImpl(set, get),

  updateParty: (id, patch) => set({
    parties: get().parties.map(p => {
      if (p.id !== id) return p
      const next = { ...p, ...patch }
      // Keep member slots in sync with headcount.
      // When ONLY the type changes (the chip selector), reset the count to the
      // NEW type's default headcount (non-solo = 2), not the party's old count.
      // When members/headcount is passed explicitly, honor that.
      if (patch.type || patch.members || patch.headcount !== undefined) {
        const newType = patch.type || p.type
        let count
        if (patch.members?.length) {
          count = patch.members.length
        } else if (patch.headcount !== undefined) {
          count = patch.headcount
        } else if (patch.type) {
          // type-only change → snap to the new type's default headcount
          count = PARTY_HEADCOUNT[newType] ?? (newType === 'solo' ? 1 : 2)
        } else {
          count = headcountOf(p)
        }
        next.members = syncMembers(p, newType, count)
      }
      return next
    })
  }),

  updateMember: (id, index, patch) => set({
    parties: get().parties.map(p => {
      if (p.id !== id) return p
      const members = p.members.map((m, i) => i === index ? { ...m, ...patch } : m)
      return { ...p, members }
    })
  }),

  setMemberCount: (id, count) => set({
    parties: get().parties.map(p => {
      if (p.id !== id) return p
      const n = p.type === 'solo' ? 1 : Math.max(1, Math.min(20, count || 1))
      return { ...p, members: syncMembers(p, p.type, n) }
    })
  }),

  deleteParty: (id) => {
    const parties = get().parties.filter(p => p.id !== id)
    const activePartyId = get().activePartyId === id ? null : get().activePartyId
    set({ parties, activePartyId })
  },

  setActiveParty: (id) => {
    const p = get().parties.find(x => x.id === id)
    // When switching to a party, set flowStep based on whether it is already
    // completed or has a drawn path. A completed party (completedAt set) goes
    // straight to 'done' so it stays locked; otherwise a party with a path
    // shows the "완료" button, and a new party starts at the info step.
    let flowStep
    if (p && p.completedAt) flowStep = 'done'
    else flowStep = p && p.path.length >= 2 ? 'path' : 'info'
    set({ activePartyId: id, flowStep })
  },

  // ── Tools ──
  setActiveTool: (tool) => set({ activeTool: tool }),
  setActiveEventType: (type) => set({ activeEventType: type }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  togglePartyVisible: (id) => {
    const { visiblePartyIds, parties } = get()
    const allIds = parties.map(p => p.id)
    if (visiblePartyIds === null) {
      // Currently showing all → start filtering with only this party visible
      set({ visiblePartyIds: [id] })
    } else {
      if (visiblePartyIds.includes(id)) {
        // Remove this party from visible set
        const next = visiblePartyIds.filter(pid => pid !== id)
        // If all parties visible again → reset to null (show all)
        if (next.length === allIds.length) set({ visiblePartyIds: null })
        else set({ visiblePartyIds: next })
      } else {
        // Add this party to visible set
        const next = [...visiblePartyIds, id]
        if (next.length === allIds.length) set({ visiblePartyIds: null })
        else set({ visiblePartyIds: next })
      }
    }
  },
  resetPartyFilter: () => set({ visiblePartyIds: null }),

  // ── Drawing ──
  // A party is locked once completed (completedAt set). Guarded here so ANY
  // caller — not just CanvasMap — can't keep adding to a finished route.
  startDraw: () => { if (activeIsCompleted(get)) return; set({ drawing: true, currentPath: [] }) },
  addPathPoint: (x, y) => {
    if (activeIsCompleted(get)) return
    const cp = [...get().currentPath, { x, y }]
    set({ currentPath: cp })
  },
  // Commit the just-drawn stroke onto the active party.
  // APPEND, never replace: the same customer's route is made of many swipes
  // (interleaved with event taps). Each lifted finger closes one segment;
  // earlier segments are a record and must survive. If the party already has
  // a committed path, the new segment's points are concatenated on so the map
  // shows one continuous route (old tail → new head).
  endDraw: () => {
    if (activeIsCompleted(get)) return
    const { currentPath, activePartyId, parties } = get()
    if (currentPath.length >= 2 && activePartyId) {
      const updated = parties.map(p =>
        p.id === activePartyId
          ? { ...p, path: [...p.path, ...currentPath] }
          : p
      )
      set({ parties: updated, currentPath: [], drawing: false })
    } else {
      set({ currentPath: [], drawing: false })
    }
  },
  appendPathPoint: (x, y) => {
    if (activeIsCompleted(get)) return
    const { activePartyId, parties } = get()
    set({
      parties: parties.map(p =>
        p.id === activePartyId ? { ...p, path: [...p.path, { x, y }] } : p
      )
    })
  },
  clearPath: () => {
    if (activeIsCompleted(get)) return
    const { activePartyId, parties } = get()
    set({
      parties: parties.map(p =>
        p.id === activePartyId ? { ...p, path: [] } : p
      ),
      currentPath: [],
    })
  },

  // ── Events ──
  addEvent: (x, y) => {
    const { activePartyId, parties, activeEventType } = get()
    if (!activePartyId) return
    if (activeIsCompleted(get)) return
    const ev = {
      id: `e${nextEventId++}`,
      type: activeEventType,
      x, y,
      ts: Date.now(),
    }
    set({
      parties: parties.map(p =>
        p.id === activePartyId ? { ...p, events: [...p.events, ev] } : p
      )
    })
    // "나감" (leave) is the end-of-visit signal: tapping it completes this
    // customer's route automatically (Q2-a). Defer a beat so the marker
    // paints before the done-overlay appears, and only fire if we're still in
    // the path step on the same party (user hasn't navigated away meanwhile).
    if (activeEventType === 'leave') {
      const pid = activePartyId
      setTimeout(() => {
        const cur = get()
        if (cur.flowStep === 'path' && cur.activePartyId === pid) {
          get().completeCurrentParty()
        }
      }, 250)
    }
  },

  removeEvent: (partyId, eventId) => set({
    parties: get().parties.map(p =>
      p.id === partyId
        ? { ...p, events: p.events.filter(e => e.id !== eventId) }
        : p
    )
  }),

  // ── Toast ──
  showToast: (msg) => {
    set({ toast: msg })
    setTimeout(() => set({ toast: null }), 2500)
  },

  // ── Mobile Flow State ──
  // 'info' = customer info step, 'path' = path drawing step, 'done' = complete
  flowStep: 'info',
  setFlowStep: (step) => set({ flowStep: step }),
  // Mobile: selected party (for info step)
  selectedPartyId: null,
  setSelectedParty: (id) => set({ selectedPartyId: id }),
  // Mobile: bottom sheet expanded
  sheetExpanded: false,
  toggleSheet: () => set(s => ({ sheetExpanded: !s.sheetExpanded })),
  // Mobile: menu open
  menuOpen: false,
  setMenuOpen: (v) => set({ menuOpen: v }),

  // Complete current party: mark done, do NOT auto-start a new party.
  // The user explicitly adds the next route.
  completeCurrentParty: () => {
    const { parties, activePartyId } = get()
    if (activePartyId) {
      const party = parties.find(p => p.id === activePartyId)
      if (party && party.path.length > 0) {
        const completedAt = new Date().toISOString()
        set({
          flowStep: 'done',
          toast: `동선 완료 — ${party.name}`,
          parties: parties.map(p =>
            p.id === activePartyId ? { ...p, completedAt } : p
          ),
        })
        return
      }
    }
    // No active party or no path yet — just show a hint
    set({ toast: '완료할 동선이 없습니다. 새 동선을 추가하세요.' })
  },

  // Complete the active party. Does NOT auto-start a new one.
  completeAndStartNext: () => {
    const { parties, activePartyId } = get()
    if (activePartyId) {
      const party = parties.find(p => p.id === activePartyId)
      if (party && party.path.length > 0) {
        const completedAt = new Date().toISOString()
        set({
          flowStep: 'done',
          toast: `동선 완료 — ${party.name}`,
          parties: parties.map(p =>
            p.id === activePartyId ? { ...p, completedAt } : p
          ),
        })
        return
      }
    }
    set({ toast: '완료할 동선이 없습니다. 새 동선을 추가하세요.' })
  },

  // ── Import/Export ──
  // Single export format: floor plan + all parties (with paths, events, completedAt).
  // Filename includes the export date so files are date-grouped on disk.
  exportData: () => {
    const { floorplanUrl, parties } = get()
    return JSON.stringify(
      {
        version: 3,
        kind: 'full',
        exportedAt: new Date().toISOString(),
        floorplanUrl: floorplanUrl,
        parties: parties.map(p => ({
          id: p.id,
          name: p.name,
          type: p.type,
          members: p.members,
          headcount: p.headcount,
          shoppingTool: p.shoppingTool,
          path: p.path,
          completedAt: p.completedAt,
          events: p.events,
          color: p.color,
        })),
      },
      null,
      2
    )
  },

  // Accepts v1/v2/v3 payloads. v3 has completedAt; older versions default to null.
  importData: (json) => {
    try {
      const data = JSON.parse(json)
      let imported = data.parties
      // Normalize: ensure members present, completedAt present
      if (imported) {
        imported = imported.map(p => ({
          ...p,
          members: p.members?.length
            ? p.members
            : Array.from({ length: p.headcount || 1 }, () => makeMember()),
          shoppingTool: p.shoppingTool || 'none',
          path: p.path || [],
          completedAt: p.completedAt || null,
          events: p.events || [],
        }))
      }
      if (imported) {
        let maxP = 0, maxE = 0
        imported.forEach(p => {
          const n = parseInt(String(p.id).replace('p', '').replace('c', ''))
          if (!isNaN(n) && n > maxP) maxP = n
          p.events?.forEach(e => {
            const n2 = parseInt(e.id.replace('e', ''))
            if (n2 > maxE) maxE = n2
          })
        })
        nextPartyId = maxP + 1
        nextEventId = maxE + 1
        set({
          floorplanUrl: data.floorplanUrl || null,
          parties: imported,
          activePartyId: imported[0]?.id || null,
        })
        return true
      }
    } catch { /* ignore */ }
    return false
  },
}), {
  name: 'customer-flow-v3',
  version: 3,
  // Exclude floorplanUrl from persistence: it's a large image dataURL that
  // overflows the 5MB localStorage quota on iOS WebKit, and every store update
  // re-serializes the whole persisted state — so the quota error propagates
  // into React handlers and freezes the UI. The floorplan stays in memory for
  // the session; re-select it on reload.
  partialize: (s) => ({
    parties: s.parties,
    activePartyId: s.activePartyId,
    visiblePartyIds: s.visiblePartyIds,
  }),
  // ── Defensive rehydrate ─────────────────────────────────────────────────
  // Older builds (v1/v2) persisted a different shape — including floorplanUrl
  // and, on some devices, a partially-written / corrupt parties array (e.g. a
  // party with `members: null` or a truncated base64). Rehydrating that raw
  // state crashed components that assumed `party.members` is an array,
  // unmounting the whole React tree → blank (black) screen on load.
  // Normalize every incoming persisted object here so a corrupt or legacy
  // localStorage can never take the app down: coerce each party to the v3
  // shape, drop anything that can't be salvaged, and ignore unexpected keys.
  migrate: (persisted, version) => {
    try {
      if (!persisted || typeof persisted !== 'object') return {}
      const rawParties = Array.isArray(persisted.parties) ? persisted.parties : []
      const parties = rawParties
        .filter((p) => p && typeof p === 'object')
        .map((p) => {
          const type = PARTY_TYPES.some((t) => t.id === p.type) ? p.type : 'solo'
          const members = Array.isArray(p.members) && p.members.length
            ? p.members.map((m) => ({
                age: (m && (m.age || m.type)) || 'none',
                gender: (m && m.gender) || 'none',
              }))
            : defaultMembers(type)
          const path = Array.isArray(p.path)
            ? p.path
                .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
                .map((pt) => ({ x: pt.x, y: pt.y }))
            : []
          const events = Array.isArray(p.events)
            ? p.events
                .filter((e) => e && Number.isFinite(e.x) && Number.isFinite(e.y))
                .map((e, i) => ({
                  id: e.id || `ev-restored-${i}`,
                  type: e.type || 'pass',
                  x: e.x,
                  y: e.y,
                  ts: e.ts || null,
                }))
            : []
          return {
            id: p.id || `p-restored-${Math.random().toString(36).slice(2, 8)}`,
            name: typeof p.name === 'string' ? p.name : `동선`,
            type,
            members,
            shoppingTool: p.shoppingTool || 'none',
            path,
            completedAt: typeof p.completedAt === 'string' ? p.completedAt : null,
            events,
            color: p.color,
          }
        })
      const visiblePartyIds = Array.isArray(persisted.visiblePartyIds)
        ? persisted.visiblePartyIds.filter((id) => parties.some((p) => p.id === id))
        : parties.map((p) => p.id)
      const activePartyId = parties.some((p) => p.id === persisted.activePartyId)
        ? persisted.activePartyId
        : (parties[0] && parties[0].id) || null
      // `version` may be undefined for pre-versioned legacy storage; the
      // normalization above is version-agnostic, so we don't need to branch.
      void version
      return { parties, activePartyId, visiblePartyIds }
    } catch {
      // Any corruption at all → start clean rather than crash.
      return {}
    }
  },
}))
