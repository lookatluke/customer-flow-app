# Customer Flow App — End-to-End Verification Report

**Date:** 2026-11-19
**Verifier:** Hermes Agent (live in-app test, not code review)
**App:** `/Users/luke/customer-flow` → `dist/index.html` (299,950 bytes, single-file build)
**Browser:** Ego Lite (Chromium) on macOS 27, via `http://127.0.0.1:8917/`
**Method:** Real store actions driven by an in-app test harness (`?demo=1`), each stage captured as a screenshot. No stage verified by reading code alone.

## Summary

✅ **The full journey works end-to-end:** floor plan load → customer registration → route drawing/recording → completion → statistics. Verified live with three screenshots.

⚠️ **One real bug was found and fixed during this test:** the Statistics tab crashed the whole app (`floorplanUrl is not defined` → black screen). Fixed in `src/components/StatsPanel.jsx`. See "Bug Found & Fixed" below.

---

## Stage-by-stage verification (with screenshots)

### Stage 1 — Floor plan load + customer registration panel
**Screenshot:** `screenshots/stage1_map_registration.png`

- Floor plan image loads and renders with all zones labeled: **ENTRANCE, S13 Groceries, S14 Bakery, S15 Produce, R13 Apparel, R14 Electronics, CHECKOUT, EXIT**.
- Right sidebar **"고객 동선 (0)"** (Customer Flow, 0 customers) shows the registration panel: group-type filters (혼자/커플·부부/친구/가족/단체), visit-info options, memo field, and the blue **"동선 만들기"** (create path) button.
- Left toolbar exposes the **동선** (path) / **이벤트** (event) tools and a **전체 (0)** counter.
- **Result:** ✅ registration UI present, 0 customers, floor plan loaded.

### Stage 2 — Route input (3 customers registered + routes drawn)
**Screenshot:** `screenshots/stage2_routes_drawn.png`

- Three customers registered in the sidebar: **가족 A** (Family A), **커플 B** (Couple B), **개인 C** (Individual C); header now reads **"고객 동선 (3)"**.
- Three distinct **colored route lines** (blue / pink / green) with circular customer markers drawn across the floor plan, each following a different path between entrance and checkout/exit.
- Toolbar switches to **동선 지우기** (clear path), confirming an active drawing state.
- **Result:** ✅ registration + route drawing/recording both functional.

### Stage 3 — Statistics confirmation
**Screenshot:** `screenshots/stage3_stats.png`

- **통계 (Statistics) tab** is active, badge shows **3**.
- Summary cards: **고객 동선 3**, **interactions 3**, **events 9**, **여성 비율 0%**.
- Distribution panels rendered: **그룹 유형 분포** (group type), **연령대 분포 (방문객 기준)** (age), **성별 분포** (gender), **쇼핑 도구 분포** (shopping tool).
- All three customer paths overlaid on the canvas; toast **"동선 완료 — 개인 C"** (route complete — Individual C) confirms completion.
- **Result:** ✅ stats tab renders with live data from all 3 completed customers.

---

## Bug Found & Fixed (during this test)

| Item | Detail |
|------|--------|
| **Symptom** | Black screen (entire React tree unmounted) once the Statistics tab rendered. |
| **Root cause** | `src/components/StatsPanel.jsx` used `floorplanUrl` (lines ~245, 246, 289, 290) but only destructured `parties` from `useStore()`. `floorplanUrl` was an undeclared identifier → `ReferenceError: floorplanUrl is not defined` at render → React unmount. |
| **Why it was missed before** | The app renders fine on the initial map view; the crash only fires when Stats renders, which no prior manual path had reached. The in-app auto-run scenario is what first exercised it. |
| **Fix** | `const { parties } = useStore()` → `const { parties, floorplanUrl } = useStore()` in `StatsPanel`. |
| **Verification** | Rebuilt; re-ran the full scenario to the stats tab — renders correctly (Stage 3 screenshot). |

## Test harness (kept in the build, opt-in)

`src/App.jsx` has a dev-only harness activated by `?demo=1`:
- Auto-loads `test_floorplan.png` (bypasses the file dialog, which is not automatable).
- `window.__CF_DEMO__.journey({...})` walks the **real** store actions (`addParty`, `setMemberCount`, `startDraw`/`addPathPoint`/`endDraw`, event adds, `completeCurrentParty`, `setActiveTab`).
- URL params: `fresh=1` (wipe localStorage), `stage=map|routes` (stop at a stage for deterministic screenshots).
- An on-screen render-error overlay (`#cf-render-error`) surfaces any uncaught React render error so a blank page is diagnosable from a screenshot — this is what exposed the `floorplanUrl` bug.

These are inert without `?demo=1` and do not affect normal use.

## Second round of fixes — Statistics tab map clipping + misalignment (2026-11-19)

After the initial verification, two visual defects on the **통계 (Statistics) tab** were reported and fixed. Both were verified live with before/after screenshots.

### Bug 2 — Map clipped / off-center on the Statistics tab
| Item | Detail |
|------|--------|
| **Symptom** | On the Statistics tab the floor plan was pushed far down and clipped at the bottom (~half cut off, top half a large black gap). |
| **Root cause** | Flex/percent-height chain failure. `.main` (a `flex:1` child of `.desktop-layout`, a 100vh flex column) had **no `min-height:0`**, so its `min-height:auto` default let it grow to the height of its tallest child — the stats map side, whose natural image-driven height was **2055px**. That stretched `.main` to 2055px, overflowing the 883px viewport. The map image (centered in a 2055px box) landed below the fold and was clipped. |
| **Diagnosis** | Live pixel measurement via a temporary `document.title` logger: `main=1908x2055`, `stats-map-side=525x0`, `img=878x614`, `svg=878x614` (before). |
| **Fix** | `src/index.css`: (1) `.main` → add `min-height:0; min-width:0; height:calc(100vh - 52px); max-height:calc(100vh - 52px)` (hard viewport bound, since `flex` + `min-height:0` alone proved unreliable here). (2) `.desktop-layout` → add `overflow:hidden`. (3) `.stats-panel.stats-with-map` and `.stats-map-side` → `height:100%`. (4) `.stats-map-side .canvas-area` → `max-height/height:calc(100vh - 64px)`. |
| **Verification** | Rebuilt, re-measured: `main=1908x831`, `stats-map-side=525x831`, `area/wrap=954x831` — **all viewport-bounded**. Screenshot `screenshots/fix_stats_tab_fixed.png`: plan fully visible, no clipping, no large gap. |

### Bug 3 — Route lines (SVG) misaligned with the floor plan on the Statistics tab
| Item | Detail |
|------|--------|
| **Symptom** | Route lines (blue/pink/green) and S/E markers did not overlay the floor plan correctly — they appeared displaced relative to the zones. |
| **Root cause** | The SVG overlay used `viewBox="0 0 1 1"` with `preserveAspectRatio="none"` stretched to **the full `.canvas-wrap` container** (954×831), while the floor-plan `<img>` used `object-fit:contain` (letterboxed to 878×614, centered). The two used **different coordinate spaces**, so the SVG's 0..1 coords mapped to the container, not the image. |
| **Fix** | `src/components/CanvasMap.jsx`: added `imgRef` + `svgRef` and a `useEffect` with `ResizeObserver` (on `.canvas-wrap`) + image `onload` that computes the **exact contain-fit box** (the `<img>`'s rendered content rectangle). Both the `<img>` and `<svg>` are then positioned **identically** via inline `position:absolute; left/top/width/height` to that box (overriding the CSS `object-fit`). The SVG now occupies exactly the same rectangle as the visible image, so its 0..1 paths align to the plan. The `.stats-map-side` instance passes `width="100%" height="100%"` (no explicit `viewBox`) so the fitBox inline style controls it. |
| **Verification** | Measured `img=878x614`, `svg=878x614` — **identical dimensions** (perfect alignment). Screenshot `screenshots/fix_stats_tab_fixed.png`: all three route lines and S/E markers sit on the plan, none extend outside the plan boundary. |

### Standalone re-verification (post-fix)
- `dist/index.html` (single file, **no** local asset files in `dist/`) re-opened via **`file://`** with no server: renders the full UI cleanly — floor plan, 동선/통계 tabs, registration panel. No `Import Error`, no JS crash. Screenshot `screenshots/fix_standalone_file.png`.
- `ls dist/` → only `favicon.svg`, `icons.svg`, `index.html` — confirms zero runtime dependency on local files.

### Files changed (this round)
- `src/index.css` — `.main` viewport bound, `.desktop-layout` overflow, `.stats-with-map`/`.stats-map-side`/`.canvas-area` height chain.
- `src/components/CanvasMap.jsx` — fitBox computation + inline alignment of `img.floorplan` and `svg.overlay`.
- (Diagnostic title-logger in `App.jsx` was temporary and removed before the final build.)

## Third round — Route persistence + "나감" auto-complete (2026-11-19)

Two more behavioral bugs were reported and fixed, both in `src/store.js`. The fix direction was decided via a **grill-me adversarial interview** (see "Decisions (grill-me)" below), then verified live with a dedicated in-app verify scenario.

### Bug 4 — Previously drawn route erased when re-drawing after an event
| Item | Detail |
|------|--------|
| **Symptom** | Draw a route, then select an event (e.g. 지남/체류) and draw again — the **earlier route line disappears**, leaving only the latest segment. The route is supposed to be a cumulative record. |
| **Root cause** | `endDraw()` in `src/store.js` did `p.path = currentPath` — it **replaced** the party's path with the just-drawn segment instead of appending. Every re-draw after an event wiped the previous segments. |
| **Fix** | `endDraw()` now **appends**: `p.path = [...p.path, ...currentPath]`. A `else` branch clears `currentPath`/`drawing` when a segment is too short (<2 points) so nothing is lost or orphaned. The path is a single accumulating polyline. |
| **Verification** | Live verify scenario: party created → swipe A (3 pts) → `endDraw` → event (dwell) → swipe B (3 pts) → `endDraw`. Asserted `path.length === 6` (A+B), **not** 3 (B alone). `__VERIFY__` = `appendFix: PASS`. |

### Bug 5 — "나감" (exit) did not complete the route; no clear completion
| Item | Detail |
|------|--------|
| **Symptom** | The event toolbar has a **나감** (exit/leave) button, but tapping it did nothing to finish the customer. The user expected a tap on 나감 to end that customer's route (the "완료" they asked for). |
| **Fix** | `addEvent()` in `src/store.js` now detects `activeEventType === 'leave'` and, after the marker paints (`setTimeout 250ms`), calls `completeCurrentParty()` if the party is still on the `path` step and still active. `completeCurrentParty()` also records `completedAt` (ISO timestamp). The existing **"다음 고객 입력"** done-overlay button then starts the next customer. The manual **floating "완료"** button is kept as a fallback. |
| **Verification** | Same verify scenario, after the append assertion: set event type `leave`, `addEvent(0.80, 0.65)`, wait 600ms. Asserted `flowStep === 'done'` **and** `completedAt` present. `__VERIFY__` = `autoComplete: PASS`. Screenshot `screenshots/bugfix_verify_all_pass.png` shows window title **`CF-VERIFY: ALL-PASS`** and the **"동선 완료 — 검증"** completion state with the **나감** button visible in the event toolbar. |

### Decisions (grill-me interview)
The user ran a grill-me session on the two bugs. Settled decisions:
- **Q1 — How should the route accumulate?** → **1-b, single continuous path.** The customer's route is one polyline; re-draws **append** segments (no per-segment gaps, no "jump" artifacts). Chosen over per-segment storage (simpler rendering, no gap handling) and over reset-on-redraw (which is the bug).
- **Q2 — What should "나감" do?** → **2-a, 나감 = auto-complete.** Tapping the exit event finishes that customer's route immediately (sets `done`, records `completedAt`). Chosen over "나감 is just a marker, user still presses 완료" (extra click, the reported friction) and over "나감 blocks further input" (too rigid).
- **Q3 — What after auto-complete?** → **3-a, new party ready.** The done overlay's **"다음 고객 입력"** button starts a fresh customer (no silent auto-create, which could drop an accidental party). The manual floating 완료 path still auto-starts a new party after 1.5s — intentional, since that one is an explicit user click.

### Edge cases handled
- **Short/orphan segment:** `endDraw` else-branch discards <2-point segments and resets `drawing`, so a stray tap never leaves a dangling point.
- **Fast re-tap after 나감:** the 250ms `setTimeout` re-checks `flowStep === 'path' && activePartyId === pid` before completing, so a quick switch to another tool/party won't wrongly complete.
- **No active party:** `addEvent`/`endDraw` both early-return when `activePartyId` is null.
- **Manual fallback intact:** the floating 완료 button still works (condition `path.length >= 2 && flowStep !== 'done'`) and now sees the *accumulated* path, so it shows correctly even mid-route.

### Files changed (this round)
- `src/store.js` — `endDraw()` append fix; `completeCurrentParty()` + `completedAt`; `addEvent()` leave → auto-complete.
- `src/App.jsx` — added an opt-in `?verify=bugfix` verify scenario (walks the **real** store actions and writes `window.__VERIFY__` + `document.title`). Inert without the param.

---

## Round 6 — Dedicated "완료" button (나감 removed from event chips)

**Date:** 2026-11-19
**Request:** "완료(나감) 버튼을 따로 만들어줘. 이벤트에서 나감 버튼을 없애고 따로 완료 버튼을 만들어줘." — separate the *complete-route* action from the *event* list: remove 나감 from the event pickers and give it its own dedicated 완료 button (desktop + mobile).

### What changed
- **나감 is no longer an event chip.** All three event pickers now use a new `EDITABLE_EVENT_TYPES` export (=`EVENT_TYPES` minus `leave`):
  - `src/components/CanvasMap.jsx` — desktop `EventTypePicker` + mobile row-2 chips.
  - `src/components/Sidebar.jsx` — `ActivePartyCard` "이벤트 추가" chips.
  - `leave` is **kept in `EVENT_TYPES`** (data integrity, stats, demo data) — it is simply no longer *selectable as an event*.
- **Dedicated "✓ 완료" button (desktop):** new `.btn.complete-btn` in the map toolbar, rendered when an active party has a route (`path.length >= 2`) and `flowStep !== 'done'`. It calls `completeCurrentParty()` directly — the same action the 나감 auto-complete used, now on an explicit, always-visible button.
- **Dedicated "✓ 완료" button (mobile):** the pre-existing floating `.floating-complete` button, restyled to be the prominent primary action (larger, gradient, bottom-right above the tab bar).
- **Verify harness extended** (`?verify=bugfix`) with two new assertions:
  - **ASSERT 3** `dedicatedComplete` — a fresh party + route → `completeCurrentParty()` → `flowStep === 'done'` + `completedAt` set + route preserved.
  - **ASSERT 4** `ui` — DOM scan: **0** chips contain "나감" AND a dedicated complete button (`.complete-btn` or `.floating-complete`) exists.

### Verification (live, not code review)
- **`?verify=bugfix` → `CF-VERIFY: ALL-PASS`** in Ego Lite. All assertions green:
  `appendFix` (route persistence), `autoComplete` (legacy leave path intact), `dedicatedComplete` (new button's action), `nagamRemoved` (0 나감 chips), `completeBtn` (dedicated button present).
- **Desktop screenshot** (`screenshots/ui_routes_desktop.png`): toolbar shows **✏️ 동선 · 📍 이벤트 · 🗑️ 동선 지우기 · ✓ 완료**; event chips = 지남/제품 만짐/사진 촬영/멈춤·관심/비교·검토 — **no 나감**.
- **Mobile screenshot** (`screenshots/ui_routes_mobile.png`): captured via CDP at a real 390×780 mobile viewport (device-metrics override + mobile UA). DOM confirmed `floatingComplete:true`, `completeText:"✓ 완료"`, `nagamChip:false`. Prominent green 완료 pill floats above the bottom nav.

### Files changed (this round)
- `src/store.js` — added `EDITABLE_EVENT_TYPES` export.
- `src/components/CanvasMap.jsx` — pickers → `EDITABLE_EVENT_TYPES`; added dedicated `.complete-btn` (calls `completeCurrentParty`); import cleanup.
- `src/components/Sidebar.jsx` — `ActivePartyCard` picker → `EDITABLE_EVENT_TYPES`.
- `src/index.css` — `.btn.complete-btn` (desktop) + restyled mobile `.floating-complete`.
- `src/App.jsx` — verify harness: ASSERT 3 (dedicatedComplete) + ASSERT 4 (UI DOM: no 나감 chip, complete button present).

### Result
✅ **나감 removed from all event pickers; dedicated ✓ 완료 button now exists on both desktop (toolbar) and mobile (floating).** Verified live: `CF-VERIFY: ALL-PASS` + two screenshots (desktop 1920px, mobile 390px via CDP). The legacy 나감→auto-complete data path is preserved as a safety net, but users no longer see 나감 as an event.

## Round 7 — Full CDP E2E verification (18/18 pass, 2 viewports)

**Date:** 2026-11-19
**Script:** `scripts/e2e_verify.cjs` (CDP WebSocket → Runtime.evaluate → store bridge)
**Viewports:** desktop 1440×900 + mobile 390×780 (Emulation.setDeviceMetricsOverride)
**Result:** **18/18 PASS** on both viewports. 8 screenshots captured.

### What was verified (per viewport)

| # | Check | Assertion | Result |
|---|-------|-----------|--------|
| 1 | Floor plan + registration panel loads | `ready=true, floorImages=2, canvas=true, sidebar=true, bodyLen>5000` | ✅ |
| 2 | Customer 1 registered (family, 3 people) + route + 3 events | `path=8, events=3, members=3` | ✅ |
| 3 | Re-drawing a route APPENDS (not erase) | `before=8 → after=11` (3 new points added) | ✅ |
| 4 | 3 customers registered + all routes visible | `parties=3, withPaths=3` | ✅ |
| 5 | "나감" removed from event chips | `nagamChipCount=0` | ✅ |
| 6 | Edit events still present (5 types) | `eventsFound=5` (지남/제품 만짐/사진 촬영/멈춤/비교) | ✅ |
| 7 | Dedicated 완료 button present (desktop + mobile) | `deskComplete=true, floatComplete=true, text="✓ 완료"` | ✅ |
| 8 | Complete button works (completedAt set, route kept) | `completed=3/3, routesKept=3` | ✅ |
| 9 | Statistics tab renders with data | `crashed=false, hasStats=true, vizEls=22` | ✅ |

× 2 viewports = **18 checks total, all pass.**

### Screenshots (8 files in `screenshots/`)
- `verif_desktop_01_registration.png` — floor plan + registration panel
- `verif_desktop_02_customer1_route.png` — customer 1 route drawn
- `verif_desktop_03_three_customers.png` — all 3 routes on map
- `verif_desktop_04_stats.png` — statistics tab
- `verif_mobile_01_registration.png` — mobile registration
- `verif_mobile_02_customer1_route.png` — mobile route
- `verif_mobile_03_three_customers.png` — mobile 3 routes
- `verif_mobile_04_stats.png` — mobile stats

### Technical notes
- **CDP:** port 9333 (headless Chrome, already running), WebSocket via Node 26 native `WebSocket`.
- **Store bridge:** `window.__CF_STORE__` (zustand vanilla store) exposed by the `?demo=1` harness. Deep-copied via `JSON.parse(JSON.stringify(getState()))` before reading — no live reference leaks.
- **IIFE fix:** inner `(function(S){ ... })` must be **invoked** with `(S)` — defining without calling returns `undefined`, causing "Cannot read properties of undefined (reading 'parties')".
- **Pre-existing demo parties:** `?demo=1` auto-runs its full scenario (34 parties) before the E2E script starts. The script clears them via `__CF_STORE__.setState({ parties: [] })` before its own 3 test customers.
- **Server:** `vite preview --port 8917` started for the test, **stopped after** (port 8917 confirmed free).

### Files
- `scripts/e2e_verify.cjs` — full E2E script (18 checks × 2 viewports)
- `VERIFICATION_RESULTS.json` — structured results (allPass: true)
- `screenshots/verif_*.png` — 8 screenshots

## Test environment
- Browser: Ego Lite (macOS 27), window 1920×971 (desktop) + CDP headless target at 390×780 (mobile)
- Served by: `npx vite preview --port 8917 --strictPort` (local only; **stopped after verification**)
- Standalone proof: `dist/index.html` opens via `file://` with no server, 0 network requests.

## Conclusion
✅ **Customer registration → route input → statistics all verified live with screenshots.** Six rounds of real-bug fixes: (1) Stats tab crash (`floorplanUrl is not defined`), (2) Stats tab map clipping (2055px overflow), (3) Stats tab route/plan misalignment, (4) **route erased on re-draw after an event** (now appends), (5) **"나감" did not complete** (now auto-completes + `completedAt`), (6) **나감 buried in the event list** (now a dedicated ✓ 완료 button on desktop + mobile, 나감 removed from event chips). Rounds 4–6 verified via the opt-in `?verify=bugfix` scenario → **`CF-VERIFY: ALL-PASS`**. Ready for manual use: upload a floor plan, tap customer types, draw routes (they accumulate), and tap the dedicated **✓ 완료** button to finish each customer.
