# Office: Pixel mode + Day/Night — Technical Plan (for Claude Code CLI)

Author: Bagas (bagas_dev_lead) · 2026-11-16 · Status: PLAN ONLY, nothing implemented yet
Inputs: src/views/Office.tsx (153 lines), src/office/OfficeScene.ts (472), room.ts (511), characters.ts (614), layout.ts (185)
Open inputs from Susi: pixel tile size (assumed 64x32), night light values, day/night palettes, overview layout in Pixel mode.

---------------------------------------------------------------------------------------------------
## 1. CURRENT CODE REVIEW

### 1.1 Where the Three.js canvas is rendered
- Office.tsx:121 renders an empty host `<div ref={host} className="office-canvas">`.
- Office.tsx:37-56 `useEffect(..., [gl])` constructs `new OfficeScene(host.current, opts)`; cleanup calls `s.dispose()`.
- OfficeScene creates its own `<canvas>` (WebGLRenderer.domElement) and a CSS2DRenderer `<div>` and APPENDS both
  into the host (OfficeScene.ts:112-115). React never owns the canvas element.
- `.office-canvas` fades in (opacity 0 → 1) when `ready` flips true via `onFirstFrame` (components.css:407-408).
- Office is lazy-loaded (App.tsx:18) and only mounted while `view === "office"` (App.tsx:38). Every visit to
  another view fully disposes the scene (dispose() does renderer.dispose() + forceContextLoss() + DOM removal).
  => The full mount/dispose cycle is already exercised in production on every navigation.

### 1.2 Overlay UI
Plain React JSX, absolutely positioned over the host div inside `.office-frame` (`.ov` z-index 5):
- `.ov-tl`: `.segmented` preset buttons (overview / workspace / lounge) with per-floor agent counts.
  onClick → `setPreset(p); scene.current?.preset(p)`.
- `.ov-tr`: legend rows (PixelAvatar + name + StatusBadge). onClick → `scene.current?.focus(id)` + open agent drawer.
- `.ov-bl`: static help text ("Drag to orbit · Scroll to zoom ..."). Voxel-specific wording.
- `.ov-br`: "State updated Xs ago · every 5s".
- Name tags / zone labels are NOT React: they are CSS2DObjects (`.nametag`, components.css:421-425) created by
  characters.ts / room.ts and rendered by the CSS2DRenderer.

### 1.3 State held by Office.tsx
- `office = useApi(endpoints.office, 5_000)` → OfficeStateResponse from GET /api/office/state (polls every 5 s):
  `agents[]` (name, state: working|reviewing|idle|offline|unknown, state_reason, current_task, ...),
  `counts`, `desk_count`, `claude_tool { state: working|idle|unknown, detail }`, `kanban`, `generated_at`.
- Local state: `ready` (first frame drawn), `gl` (webglAvailable(), computed once), `preset` (Preset),
  `initError` (constructor threw). Refs: `host` (div), `scene` (OfficeScene | null).
- URL: `?focus=<id>` consumed once `ready` (Office.tsx:69-73); `setParams({agent})` opens the drawer.
- Derived: `seated`, `onFloor` counts (idle → Floor 1, else Floor 0), `legend` rows.
- If `!gl || initError`: the whole view is replaced by an ErrorPanel + table fallback (Office.tsx:87-116).

### 1.4 How OfficeScene talks to React
- Imperative class instance in a ref. Public methods: `setAgentState(id, state, label)`, `setRobotState(state, label)`,
  `preset(name)`, `focus(id)`, `setActive(bool)` (unused by Office.tsx), `stats()`, `dispose()`,
  getters `activePreset`, `visibleFloors`.
- Callbacks in via `SceneOptions`: `onSelect(id)`, `onFirstFrame()`, `onPresetChange(p)` (scene switches preset
  itself when focusing an agent on a hidden floor), plus `reducedMotion`.
- Data push: Office.tsx:60-66 effect on `[data, ready]` calls setAgentState/setRobotState.

### 1.5 Existing day/night or theme awareness
- No day/night concept anywhere. No UI-theme awareness: `scene.background = #0B0D12` fixed
  ("stays dark in both UI themes", OfficeScene.ts:117-118). Light theme only adds a frame border (components.css:405).
- IMPORTANT — lighting is already preset-driven: `LIGHT_STATES: Record<Preset, LightState>` (layout.ts:163-168)
  tweened by `go()` → `onPresetLights` → `tweenLights()` (OfficeScene.ts:132, 254, 296-308, 350-355) over
  TWEEN_MS = 1000 with easeInOutCubic. Day/night must COMPOSE with this, not replace it (see 4.1).
- 3 lights (spec budget max 3): `ambient` (AmbientLight), `sun` (DirectionalLight, pos SUN_POS), `balcony`
  (PointLight, decay 0, distance 18). Created OfficeScene.ts:121-131.
- room.ts:429-445 already builds a "Night skyline" (dark blocks #121722/#151A26 with lit windows #F5C542/#7DD3FC)
  baked into the static batch. The current look is effectively an evening scene. Since room.ts is out of scope,
  the skyline stays identical in both modes (accepted limitation, see Risks).
- Emissive glows (desk screens, bench, TV, lamp #FFB86B) are independent of lights → they read stronger at night
  automatically. No changes needed there.

---------------------------------------------------------------------------------------------------
## 2. ARCHITECTURE FOR TWO RENDERING MODES

RECOMMENDATION: Option B — one slot, mount/unmount the active renderer.

Justification:
1. The dispose path already exists and runs on every view navigation (1.1). Option B adds no new lifecycle risk;
   switching mode costs the same as navigating Dashboard → Office (which users already do).
2. Option A keeps a WebGL context + RAF loop alive while hidden. With `display:none` the ResizeObserver resizes
   the renderer to 1x1 (OfficeScene.resize uses `clientWidth || 1`), and the loop keeps running unless we also
   call `setActive(false)`. That is extra coupling for a toggle users hit rarely. Memory on this class of
   machine matters.
3. Option C is ruled out: a canvas that has handed out a "webgl2" context can never return a "2d" context
   (getContext returns null). OfficeScene also creates its own canvas, so C would require editing OfficeScene.
4. Option B leaves OfficeScene's constructor/dispose untouched.

Shape in Office.tsx:
- Two host divs with distinct React keys, only one rendered:
  `mode === "voxel" ? <div key="voxel" ref={host} .../> : <div key="pixel" ref={pixelHost} .../>`
  (keys force a fresh DOM node so no leftover canvas/label DOM can leak between backends).
- Voxel effect deps become `[gl, mode]`, early-return when `mode !== "voxel"`.
- Pixel effect deps `[mode]`, early-return when `mode !== "pixel"`; constructs `new PixelOfficeScene(pixelHost.current, opts)`.
- On mode change: `setReady(false)` before mount (fade-in reruns), and the data-push effect re-runs on `ready`
  (already in its deps), so the new backend gets current state immediately.
- After construction push current UI state: `s.setTimeOfDay(tod, { instant: true })`; if `preset !== "overview"`
  call `s.preset(preset)` (voxel tweens from overview; acceptable, or pass instant — Claude Code: use instant if
  reducedMotion, else accept the tween).
- Shared interface so Office.tsx holds one ref type:

```ts
// src/office/types.ts (NEW, tiny) — or export from PixelOfficeScene.ts
export type TimeOfDay = "day" | "night";
export type OfficeMode = "voxel" | "pixel";
export interface OfficeRenderer {
  setAgentState(id: string, state: HumanState, label: string): void;
  setRobotState(state: RobotState, label: string): void;
  preset(name: Preset): void;
  focus(id: string): void;
  setTimeOfDay(tod: TimeOfDay, opts?: { instant?: boolean }): void;
  dispose(): void;
}
```
OfficeScene already matches all but setTimeOfDay structurally (TS structural typing → no `implements` edit needed,
but adding `implements OfficeRenderer` is harmless). `scene` ref type becomes `OfficeRenderer | null`.

WebGL fallback change (small, recommended): Pixel mode needs no WebGL. If `!gl`, force `mode = "pixel"`,
disable the Voxel button (title "3D needs WebGL"), and show the table fallback ONLY if pixel init also throws.
If Hawa wants zero behaviour change here, skip it — flag as decision D4.

---------------------------------------------------------------------------------------------------
## 3. PIXEL OFFICE — Canvas 2D isometric renderer

File: src/office/PixelOfficeScene.ts (plain TS class, NOT a React component — mirrors OfficeScene's
imperative API so Office.tsx treats both the same).

### 3.1 Canvas + DPI + scaling
- Creates its own `<canvas>` and appends to the host (like OfficeScene). Also creates a `labels` div
  (`position:absolute; inset:0; pointer-events:none`) for HTML name tags.
- Backing store: `dpr = Math.min(devicePixelRatio, 2)`; `canvas.width = w*dpr`, CSS size 100%;
  `ctx.setTransform(dpr*zoom, 0, 0, dpr*zoom, 0, 0)`; `ctx.imageSmoothingEnabled = false` for crisp pixels.
- Fit-to-view: compute the iso bounding box of the active view's tiles, then
  `zoom = clamp(floor_to_0.5(min(w / bboxW, h / bboxH) * 0.9), 0.5, 3)`. Origin centres the bbox
  (replaces the fixed `originY = h * 0.3` from the brief, which won't fit both floors).
- ResizeObserver on host → resize() → redraw(). Disconnect in dispose().

### 3.2 Isometric math (src/office/pixel-layout.ts)
```ts
export const TILE_W = 64, TILE_H = 32;          // Susi to confirm
export const ELEV_PX = TILE_H;                  // 1 elevation unit = 32 px screen-up
export function isoProject(tx: number, tz: number, elev = 0, ox = 0, oy = 0) {
  return { x: (tx - tz) * TILE_W / 2 + ox, y: (tx + tz) * TILE_H / 2 - elev * ELEV_PX + oy };
}
export function screenToTile(sx: number, sy: number, ox: number, oy: number) { // inverse, elev 0 (hit-testing)
  const a = (sx - ox) / (TILE_W / 2), b = (sy - oy) / (TILE_H / 2);
  return { tx: (a + b) / 2, tz: (b - a) / 2 };
}
```
World → tile: layout.ts is the single source of truth for positions. pixel-layout.ts IMPORTS (read-only)
DESKS, BENCH, LOUNGE_SPOTS, loungeSpotFor, ZONE_LABELS and converts:
```ts
export const WORLD_PER_TILE = 2;   // world units per tile → ~20x14 tiles per floor, ~1100 px wide at zoom 1
export const toTile = (x: number, z: number) => ({ tx: (x - X_MIN) / WORLD_PER_TILE, tz: (z - Z_MIN) / WORLD_PER_TILE });
```
X_MIN/Z_MIN/X_MAX/Z_MAX: Claude Code reads the floor slab extents from room.ts (current coords span roughly
x -20..20, z -13..14) and hard-codes them in pixel-layout.ts with a comment pointing at room.ts.
This keeps agent desks/lounge spots in Pixel mode identical to Voxel mode with zero duplication.

pixel-layout.ts also holds pixel-only furniture lists per floor (positions in world coords, converted the same way):
- FLOOR0_ITEMS: desks (one per DESKS entry, footprint `width x 1`), bookshelves along the back wall,
  meeting room table, Claude bench at BENCH, stair at STAIR.x.
- FLOOR1_ITEMS: TV + sofas (TV-* spots), 3 daybeds (NAP-*), balcony rail + chairs (BAL-*), beanbags (BEAN-*),
  floor-1 stair landing.
- Each item: `{ kind, x, z, w, d, h }` (footprint in tiles, height in elevation units).

### 3.3 Draw list (no scene graph)
```ts
interface DrawItem { tx: number; tz: number; elev: number; layer: 0 | 1 | 2; draw: (ctx, sx, sy, pal) => void; depth: number }
```
- Painter's order: sort by `depth` ASC, then `layer` ASC (0 floor tiles, 1 furniture, 2 characters).
- depth = `tx + tz` of the item's FRONT-MOST tile (max tx + max tz of its footprint), NOT `+ elev`.
  Adding elevation to the sort key (as in the brief) draws tall objects in front of things standing before them.
- Multi-tile furniture longer than 2 tiles (desk rows, bookshelves, sofas): split into 1-tile slices, each its own
  DrawItem — avoids the classic iso overlap bug without a depth buffer.
- Floor tiles are static per (view, palette): render them once into an OffscreenCanvas / cached `<canvas>` and
  `drawImage` it each frame. Invalidate on resize, view change, or time-of-day change.
- Primitive helpers (in PixelOfficeScene.ts): `isoTile(ctx, sx, sy, fill)`, `isoBox(ctx, sx, sy, w, d, h, top, left, right)`
  (3 polygons: top/left/right faces with palette shades) — every furniture piece is built from isoBox.

### 3.4 Views (map to existing Preset so the floor buttons work unchanged)
- `workspace` → Floor 0 only.  `lounge` → Floor 1 only.
- `overview` → both floors. Proposal (D3, Susi to confirm): stacked cutaway — Floor 1 drawn with
  `elev += FLOOR1_LIFT` (e.g. 6 units) after Floor 0, with Floor 0 occluded area accepted. Simpler fallback if it
  looks bad: side-by-side, two origins. Implement stacked first behind a constant.
- `preset(name)`: instant switch (no tween), recompute fit, redraw. Fire `onPresetChange` only when focus() changes it.
- `focus(id)`: switch to the agent's floor preset, then draw a highlight ring under that agent for 2 s.

### 3.5 Characters
Placement (mirror characters.ts:383 rule, no walking):
- Human: `state === "idle"` → `loungeSpotFor(id)` on Floor 1; otherwise `DESKS[id]` on Floor 0
  (offline/unknown stay at desk, drawn dimmed — same as voxel).
- Robot (Claude CLI): always at BENCH on Floor 0.
- Only seated agents (`hasSeat`) are drawn, like voxel.

Figure (screen px at zoom 1, anchored at the tile centre's screen point):
- Shadow: `ctx.ellipse(sx, sy, 12, 5, 0, 0, 2π)`, `pal.shadow` (rgba, ~0.3 alpha).
- Body: 10x14 fillRect in agent hex (from opts.characters[].hex, same as voxel); 1px darker outline.
- Head: 8x8 fillRect, skin from palette; for the head face reuse `pixelCells(id)` from theme/agents (the same
  8x8 data PixelAvatar uses) drawn at 1px/cell → consistent identity with the legend. Optional, nice-to-have.
- Robot: 12x12 grey box head + orange status light when running.
- Pose: `sit` → body height 10 and offset down 4; `lie` (nap) → body rotated as a 14x8 horizontal rect.
- State dot: 6px circle above head: working #22C55E, reviewing #F5B83D, idle none, offline grey
  (reuse STATUS_HEX values from OfficeScene — copy the two constants into palettes.ts, do not import from OfficeScene).
- Desk screen glow: working → agent hex at 60%, reviewing → #F5B83D at 50% (same mapping as OfficeScene.updateDesk).

Name tags: HTML, reuse the existing `.nametag` class so both modes look the same.
- One div per character inside the labels overlay, positioned with `transform: translate(x, y)` from isoProject
  (divide by nothing — overlay is CSS px; compute with zoom but without dpr).
- Content: same structure as characters.ts setTag (dot + name + status). Lounge activity suffix from
  `LoungeSpot.activity` ("napping", "watching TV").
- `.dim` when offline / not_running, `.hidden` toggling like voxel when the floor isn't shown.

Picking (keeps "click a character → drawer" working):
- Keep per-character screen rects from the last draw; on pointerup (moved < 5 px, same rule as voxel) hit-test
  top-most (reverse draw order) → `opts.onSelect(id)`. Hover → `cursor: pointer` + `.nametag.hover`.

### 3.6 Animation
- Event-driven redraw: on setAgentState/setRobotState (only if state changed), preset, setTimeOfDay, resize.
- Idle breathing: `setInterval(redraw, 500)` (2 fps), body height ±1 px using `Math.sin(t)` per agent phase offset
  by roster index. Disabled when `reducedMotion` (no interval at all).
- Pause the interval while `document.hidden` (visibilitychange listener, same pattern as OfficeScene).
- `onFirstFrame` fired after the first full draw (drives the existing `.ready` fade-in).

### 3.7 Constructor options
Reuse `SceneOptions` from OfficeScene.ts (import the TYPE only — `import type`, so Three.js is not pulled into
the pixel code path at runtime). Office.tsx passes the identical options object to both.

### 3.8 Data interface
Same /api/office/state data via the same Office.tsx effect. No API changes, no new endpoint.

---------------------------------------------------------------------------------------------------
## 4. DAY/NIGHT

`type TimeOfDay = "day" | "night"` in src/office/palettes.ts (re-exported via types if 2.x types.ts is created).

### 4.1 Voxel (OfficeScene.ts — additive edits only)
Lights: ambient/sun/balcony created at OfficeScene.ts:121-131; tween machinery at 292-308 + 350-355.

Design — light target = f(preset, tod):
```ts
// palettes.ts
import { LIGHT_STATES, type LightState, type Preset } from "./layout";
export const VOXEL_LIGHTS: Record<TimeOfDay, Record<Preset, LightState>> = {
  day: LIGHT_STATES,                       // today's values = "day" → zero visual change by default
  night: {                                 // PLACEHOLDERS until Susi's spec
    workspace: { ambient: "#9DB0E0", ambientI: 0.35, sun: "#8FA6FF", sunI: 0.25, balconyI: 0.6 },
    lounge:    { ambient: "#8C9BD6", ambientI: 0.30, sun: "#7F95F0", sunI: 0.20, balconyI: 0.8 },
    overview:  { ambient: "#A0AEDC", ambientI: 0.32, sun: "#8FA6FF", sunI: 0.22, balconyI: 0.7 },
  },
};
export const VOXEL_BG: Record<TimeOfDay, string> = { day: "#0B0D12", night: "#05060A" }; // day = current, Susi may change
```
OfficeScene edits:
1. `private tod: TimeOfDay = "day";`
2. Constructor line 121 `const L = LIGHT_STATES.overview` → `VOXEL_LIGHTS[this.tod].overview` (identical values).
3. Line 132: `this.onPresetLights = (name) => this.tweenLights(VOXEL_LIGHTS[this.tod][name]);`
   This is the key point: without it, the next preset click would snap night lighting back to day.
4. New public method:
```ts
setTimeOfDay(tod: TimeOfDay, opts: { instant?: boolean } = {}) {
  if (tod === this.tod && !opts.instant) return;
  this.tod = tod;
  const to = VOXEL_LIGHTS[tod][this.current];
  if (opts.instant) { const t = this.toLightNow(to); this.applyLight(t, t, 1); this.lightTween = null; }
  else this.tweenLights(to);                                   // same 1000 ms easeInOutCubic as presets
  this.bgTween = { from: (this.scene.background as THREE.Color).clone(), to: new THREE.Color(VOXEL_BG[tod]), t0: performance.now() };
}
```
   Extract `toLightNow(LightState): LightNow` from tweenLights' first line (pure refactor).
   Background: lerp `scene.background` in frame() next to the lightTween block (or set instantly — fine for V1).
   reducedMotion already handled inside tweenLights.
5. `stats()` add `tod` (dev probe).
No changes to room.ts, characters.ts, layout.ts.

### 4.2 Pixel (Canvas 2D)
Palette object, no lerp, instant redraw (invalidate floor-tile cache):
```ts
export interface PixelPalette {
  bg: string; floor: [string, string]; floor1: [string, string]; wallTop: string; wallLeft: string; wallRight: string;
  wood: [string, string, string];   // top/left/right faces
  metal: [string, string, string]; fabric: [string, string, string]; screenOff: string;
  skin: string; shadow: string; outline: string; window: string; sky: string;
}
export const PIXEL_PALETTES: Record<TimeOfDay, PixelPalette> = {
  day:   { bg: "#BFD8F0", floor: ["#E8D9B0", "#DDD0A5"], wallTop: "#C4A882", ... },   // brief's values, Susi to finalise
  night: { bg: "#0B0D12", floor: ["#9C7A42", "#876A38"], wallTop: "#6B4E2A", ... },
};
```
Night extras (cheap, optional V1.1): lit-window rects, screen glows drawn with `ctx.globalCompositeOperation = "lighter"`.
Agent body colours are NOT palette-shifted (identity colours must stay recognisable).

### 4.3 Persistence
Follow the existing `mc.*` key + try/catch pattern (AppShell.tsx:44-52, Calendar.tsx:17,56):
- `mc.office.mode` = "voxel" | "pixel"   (default "voxel")
- `mc.office.timeOfDay` = "day" | "night" (default "day")
Validate on read (unknown value → default). Lazy `useState(() => read())`. Write in the setter.

---------------------------------------------------------------------------------------------------
## 5. UI CHANGES IN Office.tsx

- New state: `mode`, `tod` (lazy-init from localStorage). `scene` ref typed `OfficeRenderer | null`.
- `.ov-tl` becomes a flex row (gap 8px) containing, left → right:
  1. Mode segmented control: `<div className="segmented" role="group" aria-label="Render mode">` with two
     icon buttons — lucide-react (already a dependency, used in Drawer.tsx): `Box` (Voxel 3D) and `Grid2x2`
     (Pixel). `aria-pressed`, `title="3D voxel"` / `"Pixel office"`, `aria-label` on each.
  2. Day/night icon button: `Sun` / `Moon` (lucide), `aria-pressed={tod === "night"}`,
     `aria-label="Switch to night"`/`"Switch to day"`. onClick → `setTod(...)`; effect `[tod]` calls
     `scene.current?.setTimeOfDay(tod)`.
  3. Existing preset segmented control — unchanged.
  Thin vertical divider between groups (`.ov-sep`).
- `.ov-bl` help text by mode: voxel = current text; pixel = "Click a character for details · Use the floor buttons to switch floors".
- Legend / presets / ?focus / drawer: unchanged code paths, they call the interface methods.
- Mode switch must not lose the selected preset (pass it after mount, section 2).

CSS (src/styles/components.css, office block ~line 404-425):
- `.ov-tl { display: flex; align-items: center; gap: 4px; }`
- `.ov-sep { width: 1px; height: 20px; background: var(--border-subtle); }`
- `.segmented button.icon` / `.ov-tl .tod-btn`: 28x28, centred icon, reuse `.segmented button` colours.
- `.office-canvas.pixel canvas { image-rendering: pixelated; }`
- `.pixel-labels { position: absolute; inset: 0; pointer-events: none; }` and `.pixel-labels .nametag { position: absolute; left: 0; top: 0; }`
- Narrow screens: `.ov-tl` may collide with `.ov-tr` (270px wide). Add `@media (max-width: 900px) { .ov-tl { flex-wrap: wrap; max-width: calc(100% - 310px); } }` — verify visually.

---------------------------------------------------------------------------------------------------
## 6. FILE PLAN

NEW
- src/office/PixelOfficeScene.ts — Canvas 2D renderer class implementing OfficeRenderer.
- src/office/pixel-layout.ts — iso math, world→tile conversion (imports layout.ts read-only), furniture lists per floor.
- src/office/palettes.ts — TimeOfDay, VOXEL_LIGHTS, VOXEL_BG, PIXEL_PALETTES, status colours.
- src/office/types.ts — OfficeMode, OfficeRenderer interface (may be folded into palettes.ts if Claude Code prefers; keep it type-only).

MODIFY
- src/office/OfficeScene.ts — additive: tod field, setTimeOfDay(), preset-light composition (2 lines changed:
  121, 132), toLightNow() extraction, background lerp, stats().tod. No other behaviour change.
- src/views/Office.tsx — mode + tod state & persistence, two keyed host divs, pixel effect, interface-typed ref,
  toggles in .ov-tl, mode-specific help text, (optional D4) no-WebGL → pixel.
- src/styles/components.css — toggle layout, separator, pixel label overlay, image-rendering.
- docs/ — this file.

NO CHANGES
- room.ts, characters.ts, layout.ts, App.tsx, all other views, src/api/*, api/ backend, tests/test_office_rules.py.

---------------------------------------------------------------------------------------------------
## 7. TASK ORDER FOR CLAUDE CODE CLI
Each task ends with `npm run typecheck` green. Browser checks on the dev server (Office view).

T1  palettes.ts + types.ts skeleton (TimeOfDay, OfficeMode, OfficeRenderer, VOXEL_LIGHTS with day = LIGHT_STATES,
    placeholder night). Verify: typecheck.
T2  OfficeScene.setTimeOfDay + preset-light composition + bg. Verify in console:
    `__office.setTimeOfDay("night")` → lights dim over 1 s; then click a floor preset → stays night;
    `__office.stats().tod === "night"`; default load looks pixel-identical to before (screenshot compare).
T3  Office.tsx: tod state + localStorage + Sun/Moon button + CSS. Verify: toggle works, survives reload,
    no layout overlap with legend at 1280 px and 900 px widths.
T4  Office.tsx: mode state + localStorage + mode segmented control + keyed hosts + OfficeRenderer ref type;
    PixelOfficeScene stub (canvas filled with palette.bg, fires onFirstFrame, no-op methods, dispose removes DOM).
    Verify: switching Voxel→Pixel→Voxel 10x: no console errors, `document.querySelectorAll(".office-canvas canvas").length === 1`
    always, no "Too many active WebGL contexts" warning, legend + presets still clickable in voxel.
T5  pixel-layout.ts iso math + floor tiles per view (workspace / lounge / overview), fit-to-view, DPR cap, resize.
    Verify: three presets show three different tile layouts; resize window → stays centred; crisp at DPR 2.
T6  Furniture draw (isoBox helpers, split slices, depth sort). Verify: desks/bookshelves/bench on F0, TV/sofas/
    daybeds/balcony on F1; no object drawn over something in front of it (check desk rows and sofas).
T7  Characters + state dots + desk glow + HTML name tags + click/hover picking + focus(). Verify against live
    API: idle agents in lounge spots matching voxel, working at desks; click a figure opens the drawer;
    legend click switches floor and highlights; ?focus=<id> works in pixel mode.
T8  Breathing interval (2 fps), visibility pause, reducedMotion. Verify: DevTools Performance — no RAF loop in
    pixel mode, interval stops when tab hidden; with emulated reduced motion no interval.
T9  Pixel palettes day/night wired to setTimeOfDay (cache invalidation). Verify: instant switch, persists.
T10 `npm run build` (tsc + vite). Verify: Pixel code lands in the lazy Office chunk; PixelOfficeScene has no
    runtime `three` import (check with `grep -c three dist/assets/<pixel-related chunk>` or source `import type` only);
    full manual pass: both modes x both TODs x three presets, light + dark UI theme.

---------------------------------------------------------------------------------------------------
## 8. RISKS / NOTES

R1  WebGL vs 2D context: avoided entirely — Option B uses separate canvases created by each backend; a WebGL
    canvas is never reused. OfficeScene.dispose() already calls forceContextLoss(). Rapid toggling could still
    hit the browser's ~16 live-context limit if dispose ever fails → T4 includes a 10x toggle check.
R2  Lighting composition: if setTimeOfDay only tweens lights once, the next preset() resets to day values.
    Mitigated by changing onPresetLights to read VOXEL_LIGHTS[this.tod] (4.1 step 3).
R3  Skyline in room.ts is baked night art (lit windows) and stays in day mode because room.ts is out of scope.
    If Susi wants a day sky, that is a follow-up touching room.ts (would need the skyline windows as a Glow).
R4  "Day" = today's lighting by default so existing users see no change. If Susi defines brighter day values,
    only VOXEL_LIGHTS.day changes.
R5  Iso depth sorting with multi-tile objects is the main correctness risk in pixel mode → slice furniture into
    1-tile DrawItems; sort key excludes elevation.
R6  Canvas 2D at high DPI: cap dpr at 2 (matches renderer.setPixelRatio). Static floor cached; per-frame cost is
    ~100 fillRect/path calls at 2 fps → negligible.
R7  Overlay crowding: three control groups in .ov-tl plus 270px legend on the right; check < 1100 px widths.
R8  Types: Canvas 2D types come from lib "DOM" (tsconfig lib already has it). No new deps; lucide-react icons
    already installed. Bundle impact ≈ the size of the new TS only; Three.js is not imported by pixel code.
R9  noUnusedLocals/noUnusedParameters are on: drawFn signatures with unused params need `_` prefixes.
R10 Office stays lazy-loaded; pixel mode still downloads the Three.js chunk because PixelOfficeScene is in the
    same view module. Acceptable for V1. Follow-up: dynamic `import("../office/OfficeScene")` inside the voxel effect.

---------------------------------------------------------------------------------------------------
## DECISIONS NEEDED (block nothing before T5)
D1 Susi: tile size (64x32 assumed), WORLD_PER_TILE (2 assumed).
D2 Susi: night light values (placeholders in 4.1) and full day/night pixel palettes.
D3 Susi: Pixel overview layout — stacked cutaway (default) vs side-by-side.
D4 Hawa: when WebGL is unavailable, fall back to Pixel mode instead of the table? (recommended yes)
