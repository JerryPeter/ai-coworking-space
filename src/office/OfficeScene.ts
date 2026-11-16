// Plain Three.js office scene (no R3F). Owns renderer, camera, controls, room and characters.
// Spec 7.0 (renderer/lights), 7.3 (state visuals), 7.6 (camera), 6.7 (name tags).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { GeoCache, Human, Robot, type Character, type HumanState, type RobotState } from "./characters";
import { buildFloor0, buildFloor1, type Floor0, type Floor1, type Glow } from "./room";
import { hasSeat, PRESETS, type Preset } from "./layout";

const DEG = Math.PI / 180;

export type { Preset };

export interface SceneCharacter { id: string; hex: string; shortName: string; index: number }
export interface SceneOptions {
  characters: SceneCharacter[];   // the 4 agents with seats (spec roster order)
  robot: SceneCharacter;
  onSelect: (id: string) => void;
  onFirstFrame?: () => void;
  reducedMotion: boolean;
}

const STATUS_HEX = { working: "#22C55E", reviewing: "#F5B83D" };
const OFF = new THREE.Color(0, 0, 0);
const BENCH_SCREEN = new THREE.Color("#F97316").multiplyScalar(0.6);
const BENCH_STRIP = new THREE.Color("#F97316");

const TV_STANDBY = new THREE.Color("#1E293B");
const TV_CYCLE = ["#5B7CFA", "#2DD4BF", "#A78BFA"].map((h) => new THREE.Color(h));

function easeInOutCubic(p: number) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private elapsed = 0;
  private raf = 0;
  private active = true;
  private floor0: Floor0;
  private floor1: Floor1;
  private geo = new GeoCache();
  private chars = new Map<string, Character>();
  private agentGroup = new THREE.Group();
  private tvTarget = new THREE.Color();
  private pickables: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private mouseDirty = false;
  private hovered: Character | null = null;
  private down: { x: number; y: number } | null = null;
  private tween: { fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t0: number } | null = null;
  private ro: ResizeObserver;
  private firstFrame = false;
  private states = new Map<string, string>();
  private ledTimers = [0, 0];
  private ledOn = [false, false];
  private opts: SceneOptions;
  private agentHex: Record<string, string> = {};

  constructor(private container: HTMLElement, opts: SceneOptions) {
    this.opts = opts;
    // Renderer: antialias, capped pixel ratio, NO shadows, sRGB output (spec 7.0).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    container.appendChild(this.labels.domElement);

    // The scene stays dark in both UI themes.
    this.scene.background = new THREE.Color("#0B0D12");
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 10);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = false;
    this.scene.add(sun, sun.target);

    // Camera + orbit controls
    const p = PRESETS.overview;
    this.camera.position.set(...p.pos);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...p.target);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false,
      minPolarAngle: 10 * DEG, maxPolarAngle: 80 * DEG, minDistance: 8, maxDistance: 75,
      rotateSpeed: 0.6, zoomSpeed: 0.8,
    });
    this.controls.update();

    // Two floors (Floor 1 group sits at y = FLOOR_H). No grid helper in the new scene.
    opts.characters.forEach((c) => { this.agentHex[c.id] = c.hex; });
    this.floor0 = buildFloor0(this.agentHex);
    this.floor1 = buildFloor1();
    this.scene.add(this.floor0.group, this.floor1.group);

    // Characters live in ONE world-space group and change floor by world Y (tech plan 3.3), so a
    // walker can cross floors on the stair without re-parenting. Floor-1 spots are authored in
    // floor-local coordinates and placed at world y = local y + FLOOR_H via floorY().
    this.agentGroup.name = "agents";
    this.scene.add(this.agentGroup);
    opts.characters.filter((c) => hasSeat(c.id)).forEach((c) => {
      const h = new Human({ id: c.id, index: c.index, agentHex: c.hex, reducedMotion: opts.reducedMotion }, this.geo);
      this.chars.set(c.id, h);
      this.agentGroup.add(h.root);
    });
    const r = new Robot({ id: opts.robot.id, index: opts.robot.index, agentHex: opts.robot.hex, reducedMotion: opts.reducedMotion }, this.geo);
    this.chars.set(opts.robot.id, r);
    this.agentGroup.add(r.root);
    this.chars.forEach((c) => this.pickables.push(...c.meshes));

    // Input
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.loop();
  }

  // ---------------- data ----------------
  setAgentState(id: string, state: HumanState, label: string) {
    const c = this.chars.get(id);
    if (!(c instanceof Human)) return;
    const prev = this.states.get(id);
    this.states.set(id, state);
    if (prev !== state) c.setState(state);
    const ident = this.opts.characters.find((x) => x.id === id)!;
    c.setTag(ident.shortName, label, ident.hex, state === "offline");
    this.updateDesk(id, state);
  }

  setRobotState(state: RobotState, label: string) {
    const c = this.chars.get(this.opts.robot.id);
    if (!(c instanceof Robot)) return;
    c.setState(state);
    c.setTag(this.opts.robot.shortName === "Claude CLI" ? "Claude Code CLI" : this.opts.robot.shortName, label, this.opts.robot.hex, state === "not_running");
    this.states.set(this.opts.robot.id, state);
  }

  private deskTargets = new Map<Glow, THREE.Color>();
  private updateDesk(id: string, state: HumanState) {
    const d = this.floor0.desks[id];
    if (!d) return;
    const screen = state === "working" ? new THREE.Color(this.agentHex[id]).multiplyScalar(0.6)
      : state === "reviewing" ? new THREE.Color("#F5B83D").multiplyScalar(0.5) : new THREE.Color(0, 0, 0);
    const strip = state === "working" ? new THREE.Color(STATUS_HEX.working)
      : state === "reviewing" ? new THREE.Color(STATUS_HEX.reviewing) : new THREE.Color(0, 0, 0);
    this.deskTargets.set(d.screen, screen);
    this.deskTargets.set(d.strip, strip);
    if (d.laptopScreen) this.deskTargets.set(d.laptopScreen, state === "working" ? new THREE.Color("#84CC16").multiplyScalar(0.35) : new THREE.Color(0, 0, 0));
  }

  // ---------------- camera ----------------
  preset(name: Preset) {
    const p = PRESETS[name];
    this.tweenTo(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.target));
  }

  focus(id: string) {
    const c = this.chars.get(id);
    if (!c) return;
    const target = c.headWorld(new THREE.Vector3());
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(10);
    this.tweenTo(target.clone().add(offset), target);
  }

  private tweenTo(pos: THREE.Vector3, target: THREE.Vector3) {
    if (this.opts.reducedMotion) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = { fromP: this.camera.position.clone(), toP: pos, fromT: this.controls.target.clone(), toT: target, t0: performance.now() };
    this.controls.enabled = false; // input disabled during the tween
  }

  // ---------------- lifecycle ----------------
  setActive(a: boolean) {
    this.active = a;
    if (a) { this.timer.update(); if (!this.raf) this.loop(); }
  }

  private onVisibility = () => {
    if (!document.hidden && this.active && !this.raf) { this.timer.update(); this.loop(); }
  };

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.labels.setSize(w, h);
  }

  private loop = () => {
    // Pause the render loop entirely while the tab is hidden or the view inactive.
    if (document.hidden || !this.active) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1); // capped so a resumed loop doesn't jump
    this.elapsed += dt;
    this.frame(dt);
  };

  private frame(dt: number) {
    if (this.tween) {
      const p = Math.min(1, (performance.now() - this.tween.t0) / 600);
      const e = easeInOutCubic(p);
      this.camera.position.lerpVectors(this.tween.fromP, this.tween.toP, e);
      this.controls.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
      if (p >= 1) { this.tween = null; this.controls.enabled = true; }
    }
    this.controls.update();

    if (this.mouseDirty) { this.mouseDirty = false; this.pick(); }
    this.chars.forEach((c) => c.update(dt, this.elapsed));
    // "<Name>'s desk" shows only while that agent is away from the desk (spec 2.B).
    this.chars.forEach((c, id) => { const l = this.floor0.deskLabels[id]; if (l && c instanceof Human) l.visible = !c.atDesk(); });

    // Desk screens / strips lerp over ~1s
    const a = 1 - Math.exp(-dt * 4.5);
    this.deskTargets.forEach((target, g) => g.mat.emissive.lerp(target, a));

    // Claude bench (spec 7.5): screen + back strip orange while Running; server LEDs blink randomly.
    const running = this.states.get(this.opts.robot.id) === "running";
    const b = this.floor0.bench;
    b.screen.mat.emissive.lerp(running ? BENCH_SCREEN : OFF, a);
    b.strip.mat.emissive.lerp(running ? BENCH_STRIP : OFF, a);
    b.leds.forEach((led, i) => {
      if (!running) { led.mat.emissive.setScalar(0); return; }
      if (this.opts.reducedMotion) { led.mat.emissive.set("#F97316").multiplyScalar(0.4); return; }
      this.ledTimers[i] -= dt;
      if (this.ledTimers[i] <= 0) { this.ledOn[i] = !this.ledOn[i]; this.ledTimers[i] = 0.5 + Math.random() * 1.5; }
      if (this.ledOn[i]) led.mat.emissive.set("#F97316").multiplyScalar(0.4); else led.mat.emissive.setScalar(0);
    });

    // TV (spec 8.4): slow accent cycle while someone is watching, dim standby otherwise.
    const watching = [...this.chars.values()].some((c) => c instanceof Human && c.settledLounge()?.zone === "tv");
    if (!watching) this.tvTarget.set(TV_STANDBY).multiplyScalar(0.08);
    else if (this.opts.reducedMotion) this.tvTarget.set(TV_CYCLE[0]).multiplyScalar(0.45);
    else {
      const u = ((this.elapsed / 8) % 1) * 3, i = Math.floor(u);
      this.tvTarget.copy(TV_CYCLE[i]).lerp(TV_CYCLE[(i + 1) % 3], u - i).multiplyScalar(0.55);
    }
    this.floor1.tv.mat.emissive.lerp(this.tvTarget, this.opts.reducedMotion ? 1 : a);

    // Name tags hide when zoomed far out, except the hovered one.
    const far = this.camera.position.distanceTo(this.controls.target) > 24;
    this.chars.forEach((c) => c.tagEl.classList.toggle("hidden", far && c !== this.hovered));

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if (!this.firstFrame) { this.firstFrame = true; this.opts.onFirstFrame?.(); }
  }

  // ---------------- picking ----------------
  private setMouse(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private onMove = (e: PointerEvent) => { this.setMouse(e); this.mouseDirty = true; };
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 5) return; // that was an orbit drag, not a click
    this.setMouse(e);
    const hit = this.hit();
    if (hit) this.opts.onSelect(hit.id);
  };
  private onLeave = () => { this.setHovered(null); };

  private hit(): Character | null {
    this.ray.setFromCamera(this.mouse, this.camera);
    const h = this.ray.intersectObjects(this.pickables, false)[0];
    return h ? this.chars.get(h.object.userData.charId) ?? null : null;
  }
  private pick() { this.setHovered(this.hit()); }
  private setHovered(c: Character | null) {
    if (c === this.hovered) return;
    this.hovered?.setHover(false);
    this.hovered = c;
    c?.setHover(true);
    this.renderer.domElement.style.cursor = c ? "pointer" : "";
  }

  // ---------------- cleanup ----------------
  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.active = false;
    this.ro.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointerleave", this.onLeave);
    this.controls.dispose();
    this.chars.forEach((c) => c.dispose());
    this.geo.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
        m.geometry?.dispose(); // shared geometries: dispose() twice is a harmless no-op
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
    this.labels.domElement.remove();
  }
}
