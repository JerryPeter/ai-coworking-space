# 3D Office: Two-Floor Redesign (Technical Plan)

Author: Bagas The Dev (bagas_dev_lead). Status: plan only, no code changed.
Pair this with Susi's visual/layout spec. Susi's spec owns the coordinates, colors and furniture.
This plan owns the structure, data model, state logic, camera, performance and task order.
If the two disagree on a number, use Susi's number. If they disagree on structure, use this plan.

Baseline commit: a01710a (working tree clean). Stack: three 0.187.0, React 19, TS 7 (tsc --noEmit),
Vite 8. Plain Three.js, no R3F. No frontend test runner. `npm run build` = typecheck + bundle.

---------------------------------------------------------------------------------------------------

## 1. CURRENT CODE STRUCTURE

### 1.1 Files

| File | Lines | Role |
|---|---|---|
| src/views/Office.tsx | 142 | React view. Mounts `OfficeScene`, polls the API, pushes state, renders the overlay UI (preset buttons, legend, footer) and a no-WebGL fallback table. Lazy-loaded in App.tsx:18. |
| src/office/OfficeScene.ts | 321 | `OfficeScene` class. Owns renderer, CSS2D label renderer, camera, OrbitControls, lights, RAF loop, picking, camera presets/tween, desk/bench glow lerps, dispose. |
| src/office/room.ts | 203 | `StaticBatch` (merges boxes into ONE vertex-colored mesh), `glowBox` (separate meshes whose emissive changes with state), `SEATS` layout table, `desk()`, `bench()`, `plant()`, `buildRoom()`. |
| src/office/characters.ts | 508 | `GeoCache`, `BaseCharacter`, `Human` (4 agents, with a walk state machine), `Robot` (Claude Code CLI, fixed at the bench), "?" box, CSS2D name tags. |

Other files involved: src/api/types.ts (`OfficeState`, `OfficeStateResponse`), src/api/client.ts
(`useApi`, `endpoints.office`), src/theme/agents.ts (`AGENTS` roster of 4 plus `CLAUDE`),
src/styles/components.css:404-423 (`.office*`, `.nametag`, `.segmented`),
src/components/agents/AgentDrawer.tsx:62,130 ("Open in 3D Office" links that use `?focus=<id>`).

### 1.2 How the room is built
- `buildRoom(agentHex)` (room.ts:157) returns `{ staticMesh, grid, dynamic, desks, bench }`.
- Every static box goes through `StaticBatch.box()`. It bakes the transform and a per-vertex color into a
  BoxGeometry. `build()` merges them with `mergeGeometries` into one `Mesh` using one
  `MeshLambertMaterial({vertexColors, flatShading})`, with `matrixAutoUpdate=false`. That is about
  113 boxes in 1 draw call.
- Parts with state-driven emissive (desk screens, monitor back strips, Bagas' laptop screen, bench
  terminal screen/strip, 2 server LEDs) are separate meshes in the `dynamic` group (13 meshes).
- There is one `GridHelper(20,20)` at y=0.005.
- Scene graph today (flat):
  ```
  scene
    AmbientLight(0.6), DirectionalLight(0.8 @ 10,20,10) + target
    room-static (1 merged mesh)
    GridHelper
    room-dynamic (Group: 13 glow meshes, some under hinge/term sub-groups)
    char-default, char-pratama_cto, char-bagas_dev_lead, char-susi_uiux (Human roots)
    char-claude_cli (Robot root, fixed at -8, 0, -9.2)
  ```

### 1.3 Scene size (world units)
- One floor, 20 x 20: x ∈ [-10, 10], z ∈ [-10, 10]. There are only back (z=-10.15) and left (x=-10.15)
  walls, 3 units tall, so it is a dollhouse cutaway.
- Workspace is the x<0 half, the lounge is the x>0 half, and a low divider at x=0 has a doorway at z ∈ [2, 4].
- Character scale is large compared with the room. A standing Human is about 5.0 tall (neck at 3.5,
  head 1.0, plus hat). The "?" box tops out around 5.5, name tags sit at y 5.4 or 6.05, and desk tops are at 2.2.
  This matters for the floor height (see 3.2).

### 1.4 State → position today
- `SEATS` (room.ts:61) is keyed by profile id: `{ p: desk[x,z], exit: [x,z], lounge: [x,z], face }`.
  Only these 4 ids get a character. The legend disables rows for any other id (`seat: !!SEATS[id]`).
- `Human.setState` (characters.ts:306): `idle` goes to `"lounge"`. Everything else (working, reviewing,
  offline, unknown) goes to `"desk"`.
- On first load and under reduced motion, the character teleports to its destination. Later changes run a
  phase machine: `sit → rise(0.3s) → walk → lower(0.3s) → sit`. The walk follows a 2D `Vector2[]` waypoint path from
  `buildPath()` (desk → exit → aisle → doorway → lounge) at 4 u/s, with yaw smoothing. Mid-walk state
  flips reverse along the already-walked points with no teleport (`reverse()`).
- Seated Y offsets: desk -0.25, lounge -0.75. While walking, Y is hard-coded to 0 (characters.ts:358).
- Visual states: working means typing arms plus a head nod. Reviewing means a head scan. Idle means a breathing neck bob and
  color ×0.8. Offline means gray (setScalar 0.4) and a dimmed tag. Unknown shows a spinning "?" box. The robot is
  running/not_running/unknown and never moves.

### 1.5 Animation
- There is one RAF loop inside `OfficeScene` (`loop()` → `frame(dt)`), using a `THREE.Timer` with dt capped at 0.1 s.
- The loop pauses when the tab is hidden (`visibilitychange`) and resumes on show. React `useEffect` only
  mounts and disposes the scene. No animation runs through React state.
- Each frame: camera tween (600 ms easeInOutCubic, controls disabled during it) → `controls.update()` →
  hover pick (only when the mouse moved) → `char.update(dt, elapsed)` → desk/bench emissive lerps →
  tag hide when camera distance > 24 → WebGL render + CSS2D render.
- `prefers-reduced-motion` is honored everywhere (teleports, no oscillation, instant camera).

### 1.6 Polling
- `useApi(endpoints.office, 5_000)` polls `/api/office/state` every 5 s through a shared cache (client.ts:200),
  and refetches on tab visibility.
- Office.tsx:57 pushes data with an effect on `[data, ready]`: `setAgentState(name, state, label)` for each
  agent and `setRobotState(...)`. `OfficeScene` dedupes unchanged states.

### 1.7 Camera (already partly there)
- `PerspectiveCamera(40°)`, OrbitControls with damping, pan off, polar 10°-70°, distance 8-30.
- Presets already exist: `overview | workspace | lounge` (OfficeScene.ts:11-16). The segmented buttons are already
  rendered in Office.tsx:116-120, and the tween is already lerp-in-loop. The redesign changes the numbers,
  adds per-preset limits and floor visibility, and syncs the React state. It is not a new system.
- `focus(id)` tweens to a character's head at distance 10. It is used by `?focus=` and legend clicks.

### 1.8 Theme
- The scene is intentionally dark in both themes (`scene.background = #0B0D12`, OfficeScene.ts:84).
- The light theme only adds a framed border (components.css:405). Overlays use themed CSS (`.segmented`, `.ov`).

---------------------------------------------------------------------------------------------------

## 2. REQUIRED CHANGES (file by file)

### 2.1 NEW src/office/layout.ts (single source of truth for coordinates)
- Exists: nothing. Coordinates are currently spread across `SEATS` (room.ts), hard-coded numbers in `buildRoom`,
  `bench()`, `Robot` (-8,0,-9.2), and `buildPath()`'s corridor points.
- Change: move every coordinate Susi specifies into typed constants here. Contents:
  `FLOOR_H`, floor footprints, `STAIR` (bottom/top/landing points, step count), `DESKS` (per agent),
  `LOUNGE_SPOTS`, `ZONE_OF` (agent → spot), `ROBOT_POS`, `PRESETS`, and helper `floorY(floor)`.
  See section 4 for types.
- Keep: export a `hasSeat(id)` (or keep a `SEATS`-compatible export) so the Office.tsx legend logic stays the same.

### 2.2 src/office/room.ts
- Exists: `StaticBatch`, `glowBox`, `desk()`, `bench()`, `plant()`, `buildRoom()` (single floor).
- Change:
  - Replace `buildRoom()` with `buildFloor0(agentHex)`, `buildFloor1()`, `buildStairs(batch)`.
    Each floor uses its own `StaticBatch`, giving 1 merged mesh per floor. Stairs go into the Floor 0 batch, or their own
    batch if the stair must stay visible while Floor 1 is hidden (recommended: own batch, 1 extra call).
  - Floor 0: floor plate, back/left walls raised to FLOOR_H so the upper slab visually rests on them,
    the meeting room (walls, table, chairs, wall screen), individual desks (reuse `desk()` as-is, driven by
    `DESKS`), the open work area, the Claude bench (reuse `bench()`, parameterize its origin), and plants.
  - Floor 1: the slab is built from boxes with a stairwell hole. TV corner (sofa(s), TV with a
    `glowBox` screen), balcony (deck outside the footprint, opaque rail bars), nap area (couch/beanbag),
    and plants. Everything is built at local y=0 and the group is placed at y=FLOOR_H. Do not bake +6 into vertices.
  - Return type becomes
    `{ floor0: FloorBuild, floor1: FloorBuild, stairs: THREE.Mesh, desks, bench, tv }`
    where `FloorBuild = { group: THREE.Group; staticMesh: THREE.Mesh; dynamic: THREE.Group }`.
  - Remove the current lounge furniture, the x=0 divider and the `SEATS.lounge/exit` fields (superseded by layout.ts).
- Keep: `StaticBatch`, `glowBox`, `Glow`, `DeskProps`, `BenchProps`, the `desk()` internals (per-agent monitor
  offsets, Bagas laptop hinge, Susi sketchbook), `bench()` internals, `plant()`. The desk glow contract
  (`desks[id].screen/strip/laptopScreen`) is unchanged, so `updateDesk()` keeps working.

### 2.3 src/office/characters.ts
- Exists: `Human` with binary `Loc = "desk" | "lounge"`, 2D path, Y=0 while walking, seated pose only.
- Change:
  - Import positions from layout.ts, not `SEATS`.
  - Change `pos: Vector2 → Vector3` and `path: Vector2[] → Vector3[]`. In the walk branch, step along 3D distance
    and compute yaw from (dx, dz) only. Set `root.position.y = pos.y` (replaces the hard-coded 0 at line 358).
  - `seat(loc)` becomes `spot(loc): Spot`, where `Spot = { x, y(world floor Y), z, yaw, pose }`.
    The desk spot uses pose `sit`. The lounge spot comes from `ZONE_OF[id]` and uses pose `sit | lean | lie`.
  - Generalize rise/lower. They currently blend between "seated at the other loc" and standing. Change them to
    blend `PoseParams` (rootYOffset, hip, rootPitch, armBase) between the source spot's pose and `STAND`,
    and between `STAND` and the target spot's pose. Store `fromSpot` explicitly instead of deriving it as
    "the other loc" (line 351).
  - `buildPath(from,to)` becomes the 3D route `desk → deskApproach[] → STAIR.bottom → STAIR.top →
    zoneApproach[] → zone` (section 4.4). Reverse it for the way back. `reverse()` works unchanged on Vector3.
  - Add idle animations per pose (section 4.6). Add `floor(): 0|1` (from `pos.y`) for visibility/picking.
  - Merge the "?" box glyph into one geometry (section 6.2).
- Keep: `BaseCharacter`, `GeoCache`, the material/colour lerp system (`applyColors`, hover tint), all
  `LOOKS`, the working/reviewing seated animations, offline gray, the unknown "?" box behaviour, name tags,
  reduced-motion teleport, the mid-walk reversal logic, and the 4 u/s speed. The `Robot` class only changes its
  position source (`ROBOT_POS` from layout).

### 2.4 src/office/OfficeScene.ts
- Exists: flat scene, one static mesh, `PRESETS` table, 600 ms tween, fixed orbit limits, pickables =
  character meshes only.
- Change:
  - Build the group hierarchy in section 3. Add `floor0Group`, `floor1Group`, `stairGroup`, `agentGroup`.
  - Make `PRESETS` come from layout.ts with per-preset limits
    `{ pos, target, minDist, maxDist, minPolar, maxPolar, floors: {0: bool, 1: bool} }`.
    `tweenTo()` takes an optional `onDone` to apply limits after the tween. Use a duration of 1000 ms
    (Pratama/Hawa ask for about 1 s).
  - Floor visibility ("cutaway"): `setFloorVisible(1, false)` hides `floor1Group` and every character whose
    `floor()===1`. Hiding the parent Object3D also hides CSS2D tags (CSS2DRenderer checks `visible`).
  - Picking: `Raycaster` does NOT skip invisible objects (it only checks layers). Filter hits to
    `obj.visible && ancestorsVisible`, and add the floor static meshes as occluders. A click only selects
    a character if the first visible hit is a character mesh. This stops clicks through the Floor 1 slab from
    selecting a Floor 0 agent.
  - Tags: CSS2D tags are never occluded by geometry. In the Lounge preset, hide tags of floor-0
    characters. In the Workspace preset, floor-1 characters are hidden anyway. Overview keeps the existing far-hide rule
    (distance > 24, which overview will exceed).
  - `focus(id)`: if the character is on a hidden floor, switch to that floor's preset visibility first, then
    fire `opts.onPresetChange?.(preset)` so React's segmented control stays in sync.
  - Per-frame: also run `c.updateVisibility()` (characters change floor while walking), plus the TV glow lerp.
  - Add dev-only stats: `stats()` returns `renderer.info.render.calls/triangles` and
    `renderer.info.memory`. Expose it as `window.__office` only when `import.meta.env.DEV`.
  - `dispose()` already traverses the scene and disposes geometry/material. Keep it. The new groups are covered.
- Keep: renderer settings (no shadows, sRGB, DPR ≤ 2, low-power), CSS2D renderer, RAF/visibility
  pause, `setAgentState` / `setRobotState` signatures, `updateDesk`, bench LED logic, hover logic,
  drag-vs-click 5 px threshold, `onSelect` → drawer.

### 2.5 src/views/Office.tsx
- Exists: the preset segmented control (Overview/Workspace/Lounge) is already built, plus the legend, footer and fallback table.
- Change (small):
  - Pass `onPresetChange: setPreset` in the scene options so `focus()` and legend clicks update the pressed button.
  - Button labels: "Overview", "Floor 0 · Workspace", "Floor 1 · Lounge". Keep the `Preset` ids unchanged.
  - Change the `SEATS` import to `hasSeat` from layout.ts.
  - Fallback table "Zone" column: "Floor 1 · Lounge (<zone>)" for idle, otherwise "Floor 0 · Workspace".
  - Footer hint: optionally add "· Use floor buttons to switch floors".
- Keep: polling interval, data effect, `?focus` effect, legend, ready fade-in, WebGL fallback.

### 2.6 src/styles/components.css
- Probably nothing to change. `.segmented` already themes for dark/light. Only touch it if longer labels need
  `white-space: nowrap` or a narrow-width rule. Add a `.nametag .zzz` style if Susi wants the nap "z z z".

### 2.7 Untouched
api/** (backend), src/api/types.ts, src/api/client.ts, all other views/components, App.tsx,
router, theme, tests/test_office_rules.py.

---------------------------------------------------------------------------------------------------

## 3. NEW SCENE ARCHITECTURE

### 3.1 Graph
```
scene  (background #0B0D12, unchanged)
├─ lights
│   ├─ AmbientLight(0xffffff, 0.6)                       (unchanged)
│   ├─ DirectionalLight(0.8) at (14, 30, 14) → target (0, 3, 0)   (raised to cover both floors)
│   └─ optional HemisphereLight instead of ambient if Susi wants the balcony to read "outdoor".
│       Max 3 lights total. No shadows.
├─ floor0Group "floor-0"  position.y = 0
│   ├─ floor0-static   (1 merged mesh: plate, walls h=FLOOR_H, meeting room, desks+chairs,
│   │                    open work area, Claude bench + server rack, plants)
│   ├─ floor0-dynamic  (desk screens/strips ×4, Bagas laptop, bench screen/strip, 2 LEDs,
│   │                    optional meeting-room wall screen)
│   └─ GridHelper (optional, or drop it)
├─ floor1Group "floor-1"  position.y = FLOOR_H (6)
│   ├─ floor1-static   (1 merged mesh: slab with stairwell hole, walls, TV corner sofas,
│   │                    TV body, balcony deck + rail bars, nap couch, plants, railing at stairwell)
│   └─ floor1-dynamic  (TV screen glow; optional balcony lamp glow)
├─ stairGroup "stairs"    (1 merged mesh: steps, stringers, handrail. World coords span y 0→6)
├─ agentGroup "agents"    (all 5 character roots; world-space positions)
│   ├─ char-default, char-pratama_cto, char-bagas_dev_lead, char-susi_uiux
│   └─ char-claude_cli
```

### 3.2 Floor height
- `FLOOR_H = 6` as requested. The Floor 1 slab occupies y ∈ [5.7, 6.0] (box h 0.3, center 5.85).
- Clearance check: standing Human top ≈ 5.0, "?" box top ≈ 5.5. It fits under 5.7. Tags are DOM, so no clash.
- The stairwell hole must cover almost the whole stair run. With rise 6 and run L, the head hits the slab
  underside once the foot height is above 0.7, which happens about 1 unit into the run. Make the hole the full
  stair footprint (simplest, and it reads well in cutaway).

### 3.3 Decision: agents live in ONE agentGroup and change world Y (they do not re-parent)
- Reason: the stair walk crosses floors. Re-parenting mid-walk means converting local/world transforms and
  switching parents at a threshold. One group with world-space `pos: Vector3` keeps the existing walk code
  (just 3D) and the existing `reverse()`.
- Floor membership is derived (`floor() = pos.y > FLOOR_H/2 ? 1 : 0`) and drives visibility and picking.
- Constraint: any future "exploded overview" (lifting floor1Group) must also offset floor-1 agents. Not in v1.
  Keep `floorY()` as the only place that knows Floor 1's height.

### 3.4 Static vs dynamic rule (same as today)
- Anything whose color/emissive never changes goes into the floor's `StaticBatch`.
- Anything whose emissive changes (screens, LEDs, TV) is a `glowBox` in that floor's dynamic group.
- Characters are never merged. Each needs pivots, per-character materials and picking.

---------------------------------------------------------------------------------------------------

## 4. AGENT STATE → ZONE MAPPING

### 4.1 Types (layout.ts)
```ts
export type FloorId = 0 | 1;
export type Pose = "stand" | "sit" | "lean" | "lie";
export type ZoneId = "tv" | "balcony" | "nap";
export interface Spot {
  x: number; z: number; floor: FloorId;
  yaw: number;           // facing when settled
  pose: Pose;
  approach: [number, number][]; // waypoints (x,z) on the same floor from the hub (stair end) to this spot
}
export interface LoungeSpot extends Spot { zone: ZoneId; id: string } // e.g. "tv-1", "balcony-2", "nap-1"

export const FLOOR_H = 6;
export const floorY = (f: FloorId) => f * FLOOR_H;
export const DESKS: Record<string, Spot>;          // per agent, floor 0, pose "sit"
export const LOUNGE_SPOTS: LoungeSpot[];           // floor 1. Suggested: tv ×2-3, balcony ×2, nap ×1-2
export const ZONE_OF: Record<string, string>;      // agent id → LoungeSpot.id (fixed)
export const STAIR: { bottom: [number, number]; top: [number, number]; steps: number; width: number };
export const ROBOT_POS: [number, number, number];
export function hasSeat(id: string): boolean;     // !!DESKS[id]
export function loungeSpotFor(id: string): LoungeSpot;
```

### 4.2 State → target

| API state | Target | Floor | Pose | Visual (unchanged code paths) |
|---|---|---|---|---|
| working   | DESKS[id] | 0 | sit | typing + nod, desk screen = agent colour, strip green |
| reviewing | DESKS[id] | 0 | sit | head scan, strip amber. NOT in the brief, but it is in `OfficeState`, so keep it at the desk. |
| idle      | loungeSpotFor(id) | 1 | sit/lean/lie per zone | per-zone idle anim, colour ×0.8 |
| offline   | DESKS[id] | 0 | sit | gray 0.4, dim tag, screen off |
| unknown   | DESKS[id] | 0 | sit | "?" box |

The binary `Loc = "desk" | "lounge"` stays. Only `idle` maps to `"lounge"`, which is exactly today's rule.

### 4.3 Zone assignment: fixed mapping per agent, with a deterministic fallback
- Recommended: a fixed `ZONE_OF` table (like today's `SEATS[*].lounge`). With 4 agents and at least 5 spots,
  nobody collides, the layout is designer-controlled (Susi can pick who naps), and positions are stable across
  reloads and polls.
- Fallback for ids not in the table (future agents, if they ever get a desk): FNV-1a hash of the id
  → index into `LOUNGE_SPOTS`, then linear-probe to the first spot not taken by the fixed table or an earlier
  fallback. This is deterministic and needs no state.
- Rejected: round-robin (assignment depends on the order agents went idle, so it changes between page loads)
  and random (positions jump across reloads).
- Placeholder until Susi decides: Hawa → tv-1, Pratama → balcony-1, Bagas → tv-2, Susi → nap-1.

### 4.4 Waypoint path (linear segments, 3D)
```
desk→lounge:
  [desk.x, 0, desk.z]
  → ...DESKS[id].approach reversed  (y=0)   // e.g. chair pull-out point, aisle point
  → [STAIR.bottom.x, 0, STAIR.bottom.z]
  → [STAIR.top.x,    6, STAIR.top.z]        // the single sloped segment = "climbing"
  → ...spot.approach                (y=6)   // landing → zone entry
  → [spot.x, 6, spot.z]
lounge→desk: the exact reverse.
```
- `approach` lists are hand-authored in layout.ts from Susi's furniture plan so paths go around desks, the meeting
  room and sofas. There is no navmesh/A*. With 5 agents and fixed spots, hand-authored is simpler and
  predictable.
- Speed: 4 u/s along the 3D path length (today's constant, Pratama's max). On the stair segment that is about
  3.2 u/s horizontal and 2.4 u/s vertical for a 6/8 slope (run 8). Expect a full desk → lounge trip of about 25-35 u,
  roughly 6-9 s plus 0.6 s rise/lower.
- Yaw from horizontal delta only, as today (`atan2(dx, dz)`), with 0.15 s smoothing.
- Feet: walk cycle (legs ±30°, 0.6 s) continues on the stair. Linear Y looks fine at this voxel scale. Do NOT
  quantize Y to step heights in v1.
- Mid-walk flips: existing `reverse()` takes the walked points plus the current position and works in 3D unchanged.
- Initial load and reduced motion: teleport to target (unchanged rule).
- Two agents can walk the stair at once and overlap (no avoidance). Accept that in v1. Optionally offset
  each agent's stair line by ±0.4 u in x using the roster index, which is cheap and avoids exact overlap.

### 4.5 Rise/lower with poses
`PoseParams = { yOff, hip, pitch, armBase }`:
- stand: { 0, 0, 0, 0 }
- sit:   { -0.25 desk / -0.75 sofa (per spot `yOff`), -90°, 0, 0 }
- lean:  { 0, 0, +12° forward root pitch, -45° arms on rail }
- lie:   { cushion height, 0 (legs straight), -90° root pitch (on back), 0 }. The root pivot is at the feet, so the
  spot position for `lie` is the foot end of the couch and yaw points along the couch. Use root rotation order
  "YXZ" so yaw is applied before pitch.
- rise blends from `fromSpot.pose` to stand (0.3 s). lower blends from stand to `toSpot.pose` (0.3 s; use 0.5 s for lie).

### 4.6 Idle animations per zone (all pivot-only, no new meshes)
- TV (sit): existing breathing bob, plus a head turn toward the TV yaw. Occasional ±5° head tilt every ~4 s (phase offset by index).
- Balcony (lean): slow weight shift with root.z ±0.03 and root.rotation.z ±2° over a 4 s period, plus head yaw scan ±15° over 6 s.
- Nap (lie): chest/body scale pulse is not possible on a merged character, so use a neck rotation.x
  ±3° over 4 s. Eyes stay (they are just boxes). Optional "z z z" as a CSS2D element above the head (no
  draw call; reuse the tag pattern with its own div) that floats up and fades with CSS animation.
- Reduced motion: hold the pose, no oscillation (same rule as today).

### 4.7 Robot (Claude Code CLI)
- It has no idle/working, only running/not_running/unknown. It stays at the Claude bench on Floor 0 in all states.
  Its position comes from `ROBOT_POS`. (Open question 9.6 if Susi wants it to go upstairs.)

---------------------------------------------------------------------------------------------------

## 5. CAMERA SYSTEM

### 5.1 Presets (numbers are placeholders until Susi's footprint is final; layout assumed 24 x 20 per floor)
```ts
export const PRESETS = {
  overview:  { pos: [28, 24, 28], target: [0, 4, 0],   minDist: 18, maxDist: 55, minPolar: 20, maxPolar: 70, floors: [true, true]  },
  workspace: { pos: [0, 16, 22],  target: [0, 1.5, -1], minDist: 8,  maxDist: 35, minPolar: 15, maxPolar: 70, floors: [true, false] },
  lounge:    { pos: [0, 22, 22],  target: [0, 7.5, -1], minDist: 8,  maxDist: 35, minPolar: 15, maxPolar: 65, floors: [true, true]  },
} as const; // polar in degrees
```
- The Workspace preset hides Floor 1 (cutaway). Without that, the slab hides the whole workspace from any
  angle above about 20°. The stairs stay visible. The Lounge preset shows both floors, but Floor 1 occludes Floor 0, and
  floor-0 tags are hidden (CSS2D shows through geometry).
- Overview shows both floors. Floor 0 is only seen through the open front/right sides (cutaway walls). Overview is
  far (> 24), so tags auto-hide there already.

### 5.2 Transition
- Reuse `tweenTo()` and its existing lerp-in-loop: `camera.position.lerpVectors` +
  `controls.target.lerpVectors` with easeInOutCubic. Change the duration from 600 to 1000 ms.
- Sequence for `preset(name)`:
  1. If the target preset shows MORE floors, set visibility immediately at tween start.
  2. Widen orbit limits to the union of old and new for the duration. OrbitControls clamps on `update()`,
     and a narrow min/max would yank the tween.
  3. Tween with controls disabled (as today).
  4. On done: apply the new preset limits. If the preset shows FEWER floors, hide at the end
     (or at the midpoint, p ≥ 0.5, which looks better when diving into Workspace).
- Reduced motion: set position, target, limits and visibility instantly (as today).
- `focus(id)` picks preset visibility by the character's floor, keeps the current orbit direction, distance 10,
  and notifies React through `onPresetChange`.

### 5.3 UI
- The floor selector stays an HTML overlay (`.ov.ov-tl .segmented`), not 3D. The 3 buttons already exist.
  Only the labels and the React sync change. Optional keyboard shortcuts 1/2/3 on the office view only
  (watch for conflicts with AppShell hotkeys, which use letter keys).

---------------------------------------------------------------------------------------------------

## 6. PERFORMANCE

### 6.1 Draw-call budget (counted from the current code)

| Item | Today | After |
|---|---|---|
| Static room | 1 | 2 (one per floor) + 1 stairs |
| GridHelper | 1 | 0-1 |
| Dynamic glows | 13 | 13 + meeting screen 1 + TV 1 + lamp 0-2 = 15-17 |
| Humans (meshes, each box is 1 call) | Hawa 20, Pratama 16, Bagas 12, Susi 15 = 63 | 63 |
| Robot | 15 | 15 |
| "?" boxes (visible only when unknown) | 19 each (1 cube + 18 glyph pixels), worst +95 | 2 each after the merge below, worst +10 |
| Total typical | ≈ 93 | ≈ 98-100 |
| Total worst (all unknown) | ≈ 188 (already over 150) | ≈ 110 |

### 6.2 Actions
- Keep `StaticBatch` merging (1 call per floor). Do NOT switch to InstancedMesh. The furniture is not repeated
  with different materials, and vertex-colour merging already gives 1 call per floor regardless of box count.
  Two to three static meshes with ~600 boxes total is about 14k vertices, which is trivial.
- Merge the "?" glyph: build the 18 glyph boxes into one `BufferGeometry` with `mergeGeometries` (cache
  it once in GeoCache under a key like "qglyph"). That gives 2 meshes per box. This fixes an existing worst-case
  overshoot, so do it regardless of the redesign.
- Hidden floor = `visible=false` means 0 calls for that floor in Workspace view.
- Optional, not needed for the budget: merge each character's same-material static parts. Skip in v1.
- Verify with `renderer.info.render.calls` via the dev-only `window.__office.stats()` in each preset, both
  with all agents idle and with all forced unknown (temporarily call `setAgentState(id,"unknown",...)` from
  the console).

### 6.3 Stair motion
- Linear waypoints (recommended, already implemented in 2D). A Bezier would need arc-length
  parameterization for constant 4 u/s speed, adds complexity, and has no visual benefit at this scale.

---------------------------------------------------------------------------------------------------

## 7. BACKWARD COMPATIBILITY (must not break)
- Other views: no file outside src/office/*, src/views/Office.tsx (and maybe components.css) changes.
  Three.js stays lazy-loaded only for the office chunk (do not import src/office/* from any other module;
  layout.ts must not be imported by Agents/Dashboard).
- API: `/api/office/state` and `OfficeStateResponse` are unchanged. `desk_index` and `agent_color` are still ignored.
- Drawer: `onSelect(id)` → `setParams({agent:id})` is unchanged. Picking gets stricter (occluders + visible-only)
  but still returns the same ids. "Open in 3D Office" (`?focus=`) must still work for every agent on either floor,
  and for the robot.
- Theme: the scene stays dark in both themes (existing design decision). Overlays must use the existing themed
  classes. Test the light theme framed border + overlays.
- Reduced motion: every new animation (stairs, poses, idle loops, camera) needs the reduced-motion branch.
- Lifecycle: the RAF loop still pauses on hidden tabs. `dispose()` still frees everything. Check by mounting and unmounting the
  office view 3 times and watching that `renderer.info.memory.geometries` does not grow.
- WebGL fallback table still renders (only the Zone text changes).
- Characters without a desk (unknown profile ids from the API) are still not rendered, and their legend row stays disabled.

---------------------------------------------------------------------------------------------------

## 8. IMPLEMENTATION ORDER FOR CLAUDE CODE CLI

Rules for every task:
- Run `npm run typecheck` after each task. Run `npm run build` at tasks 3, 7 and 9. Build with low memory on this
  host: `choom -n 1000 -- env NODE_OPTIONS=--max-old-space-size=512 npm run build`.
- Smoke test in the browser (Vite dev on 127.0.0.1:5173 proxies the API on 127.0.0.1:8742) at tasks 3, 5, 7 and 8.
- Commit after each task with the style `frontend(office): <what>`. Do not touch api/ or other views.

Task 0: layout.ts scaffold
  Create src/office/layout.ts with the types from 4.1. Copy the CURRENT coordinates in (desks from SEATS,
  robot pos, presets) so nothing visually changes yet. Point room.ts, characters.ts, OfficeScene.ts and
  Office.tsx at it. Acceptance: the scene looks identical, and typecheck passes.

Task 1: Two floors, static only
  Use Susi's footprint. Write `buildFloor0()` and `buildFloor1()`, each with its own StaticBatch and a dynamic group.
  Add floor0Group/floor1Group (Floor 1 at y=FLOOR_H, slab with stairwell hole), raise walls, remove the old
  lounge and divider, and move desks/bench to Susi's positions via layout.ts. Add the meeting room, open work area,
  TV corner, balcony and nap area as static boxes (TV screen as a glowBox). Raise the directional light.
  Temporarily set the overview preset far enough to see both floors.
  Acceptance: both floors render, desk screens still glow for working agents, no console errors.

Task 2: Staircase
  `buildStairs()`: N steps (≈12 × 0.5 rise), stringers, handrail, plus a guard rail around the stairwell on Floor 1.
  Own mesh in stairGroup. Set STAIR.bottom/top in layout.ts.
  Acceptance: the stair visually connects floor plates, and a standing character fits through the hole.

Task 3: Agents on the correct floor (teleport)
  Move Human to `pos: Vector3`, `spot()` and `floorY`. Idle goes to the lounge spot on Floor 1 (sit pose for now), everything else to the desk.
  Set `this.reducedMotion`-style teleport for ALL changes temporarily (gate the walk off).
  Put all characters in agentGroup.
  Acceptance: force states from the console and confirm placement. Clicking an agent on either floor opens the drawer.

Task 4: Lounge zone assignment
  Add LOUNGE_SPOTS (tv/balcony/nap with yaw, pose and approach lists), ZONE_OF (fixed), hash+probe fallback in
  `loungeSpotFor()`, and pose params for sit/lean/lie in rise/lower and the settled state.
  Acceptance: all 4 agents idle gives 4 distinct spots with correct static poses. Typecheck passes.

Task 5: Stair walking
  Re-enable the phase machine. Use the 3D `buildPath()` (4.4), and make the walk step in 3D with `root.y = pos.y`.
  Store fromSpot/toSpot for rise/lower. Optionally use per-agent stair lane offsets.
  Acceptance: idle↔working flips walk desk → stair → zone and back at 4 u/s. Flipping the state mid-stair
  reverses smoothly with no teleport. Reduced motion still teleports.

Task 6: Idle animations per zone
  TV head-tilt, balcony sway/scan, nap breathing plus optional CSS2D "z z z". Reduced-motion branches.
  Acceptance: each zone looks distinct, and working/reviewing desk animations are unchanged.

Task 7: Camera presets + floor selector
  Presets with limits/visibility (5.1), the 1 s tween with the limit-widening sequence (5.2), the cutaway
  hide/show, floor-aware tag hiding, visible-only + occluder picking, `onPresetChange` → React, button labels,
  and floor switching in `focus()`.
  Acceptance: each button flies in about 1 s. Orbit stays within limits. Legend click and `?focus=` on a hidden-floor
  agent switch floors and update the pressed button. Clicking through the slab does not select Floor 0 agents.
  The light theme still looks right.

Task 8: Performance pass
  Merge the "?" glyph (6.2). Add dev-only `window.__office.stats()`. Measure calls in all 3 presets for the normal
  case and the all-unknown worst case. Mount/unmount the view 3 times and confirm geometry count is stable.
  Acceptance: ≤ 150 calls worst case (expected ≈ 110), with no leaks.

Task 9: Verify + commit
  Run the full build, click through every other view (Dashboard, Agents, Task Board, Calendar, Activity, Memory) to
  confirm they are unaffected, run the WebGL-off fallback (Chrome `--disable-webgl` or a forced `webglAvailable` false),
  confirm `pytest tests/` is still green (backend untouched), rebuild dist/, and do the final commit.

---------------------------------------------------------------------------------------------------

## 9. RISKS AND OPEN QUESTIONS

9.1 TypeScript: new types live only in layout.ts and characters.ts (`FloorId`, `Pose`, `ZoneId`, `Spot`,
    `LoungeSpot`, `PoseParams`). `SceneOptions` gains optional `onPresetChange`. `Preset` ids stay the same.
    `HumanState`/`OfficeState`/API types: no change. tsconfig has `noUnusedLocals`, so delete the old
    `SEATS.exit/lounge` usages cleanly.

9.2 API: no change. The backend already returns the state, which is all we need. `desk_index` stays unused.

9.3 Memory: static geometry grows from ~113 boxes to ~500-700. Each box is 24 verts × (pos+normal+uv+color =
    11 floats) ≈ 1.1 KB plus indices, so under 1 MB CPU+GPU total. Characters are unchanged. The WebGL framebuffer
    (DPR ≤ 2) dominates and is unchanged. Estimated runtime delta: < 5 MB. The real memory risk on this host is
    the BUILD (Vite/tsc OOM history), so use the choom + 512 MB heap command. Runtime runs in the viewer's browser.

9.4 Visibility/occlusion is the hardest UX problem, not geometry. A stacked building hides Floor 0 from above.
    This plan solves it with a cutaway (Floor 1 hidden in the Workspace preset). If Susi's spec wants both floors
    fully visible at once (side-by-side "exploded" overview, translucent slab, glass floor), that needs either
    lifting floor1Group plus floor-1 agents (doable, since `floorY()` is centralized) or transparency
    (sorting artifacts with merged meshes, so avoid it).

9.5 Things in a visual spec that would be technically expensive. Flag these back to Susi:
    - Glass walls (meeting room) or glass balcony rail: transparent merged meshes sort badly. Use opaque
      thin bars or one separate transparent mesh with `depthWrite:false` (+1 call each).
    - Real shadows / soft lighting: spec 7.0 disables shadows. Keep it off.
    - Video or animated content on the TV: use an emissive colour cycle only. CanvasTexture is possible but adds
      per-frame texture uploads.
    - 3D text signage ("Lounge"): use CSS2D labels, not TextGeometry (font loading, heavy geometry).
    - Sky/outdoor view behind the balcony: the background is a solid colour. A gradient needs a big backdrop plane
      or a shader (+1 call, fine) but must work with the always-dark scene.
    - Light-theme scene colours: the scene is intentionally dark in both themes. Switching would need a theme
      prop plus a static-batch rebuild on toggle. Out of scope unless Susi insists.
    - Agents interacting with each other (sitting together at a meeting table, conversations): no API state
      maps to "meeting", so the meeting room is decor in v1.

9.6 Open questions (need Hawa/Susi decisions):
    a. Where does `reviewing` go? Plan: desk (as today). Alternative: meeting room.
    b. Who sits in the open work area vs individual desks? With 4 agents, one may be "open area". Each just
       needs a DESKS entry with pose sit.
    c. ZONE_OF: which agent gets TV / balcony / nap? (placeholder in 4.3)
    d. Robot when not_running: stay at the bench (plan) or rest upstairs? Upstairs would need a robot walk (wheels,
       no legs) plus stair handling. Recommend staying.
    e. Floor 0 footprint size and stair location (needs a ~8 × 2.5 u run). The plan assumes about 24 × 20 per floor.
    f. Overview: is the cutaway look acceptable, or does Susi want an exploded split-level view (9.4)?
