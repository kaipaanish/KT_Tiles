/**
 * AR (?view=ar), on an Android phone: mark a real wall or floor by its corners and see it tiled
 * at its real size in the camera picture. Drag on the tiles to slide the pattern (with the
 * designer's snapping); switch series and preset. The measured size and the design are saved, so
 * the designer opens on that wall and its Count tab counts it.
 *
 * A wall is marked by two opposite corners; a floor by two corners along one edge and a point on
 * the opposite edge; a plain wall the phone can't find, by two points where it meets the floor
 * and its top. Text over the camera says what to do next, and reports tracking and the frame rate
 * (kept on the phone, so it survives a crash).
 */
import './ar.css';
import { catalog } from '../designs/catalog';
import { countTiles, layoutSurface, presetsFor, type LayoutResult, type Point } from '../engine';
import { ArRenderer, type ArRect, type ArRing } from '../render/webgl/arRenderer';
import { TextureCache } from '../render/textureCache';
import * as act from '../state/actions';
import { activePlan, type DesignDoc } from '../state/document';
import { DESIGN_KEY, serializeDesign, writeStorage } from '../state/persist';
import { openingDesign } from '../ui/app';
import { h } from '../ui/dom';
import { floorFromCorners, intersectPlane, poseRay, rectOn, ringOn, surfaceMm, wallFromBase, wallFromCorners, wallUpTo, type MarkedSurface, type Ray } from './marking';
import { invertPose, multiply, surfaceFrame, surfaceToRoom, type SurfaceFrame, type SurfaceKind, type Vec3 } from './surfaceFrame';
import { checkArSupport, startArSession } from './xrSession';

/** The aiming ring's radius, and a marked corner's, in metres. */
const AIM_M = 0.08;
const CORNER_M = 0.05;
/** How close (mm) a dragged pattern must come to a magnet to jump to it. */
const MAGNET_MM = 40;

const COLOURS: Record<SurfaceKind | 'mark', [number, number, number]> = {
  wall: [31 / 255, 111 / 255, 235 / 255],
  floor: [245 / 255, 158 / 255, 11 / 255],
  ceiling: [0.6, 0.64, 0.7],
  slope: [0.6, 0.64, 0.7],
  mark: [1, 1, 1],
};

/** What's being marked: a wall by its corners, a floor, or a wall by where it meets the floor. */
type Mode = 'wall' | 'floor' | 'base';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'wall', label: 'Wall' },
  { mode: 'floor', label: 'Floor' },
  { mode: 'base', label: 'Wall by its base' },
];

/** Where the marking has got to. */
type Step =
  | { step: 'first' }
  | { step: 'wall-second'; first: SurfaceFrame }
  | { step: 'floor-second'; a: Vec3; normal: Vec3 }
  | { step: 'floor-third'; a: Vec3; b: Vec3; normal: Vec3 }
  | { step: 'base-second'; a: Vec3 }
  | { step: 'base-top'; a: Vec3; base: { frame: SurfaceFrame; widthMm: number } }
  | { step: 'tiled'; surface: MarkedSurface };

const INSTRUCTIONS: Record<Mode, Record<string, string>> = {
  wall: {
    first: 'Wall: aim the ring at one corner of the area to tile (bottom-left, say) and tap.',
    'wall-second': 'Now aim at the opposite corner (top-right) and tap.',
  },
  floor: {
    first: 'Floor: aim at one corner of the area to tile and tap.',
    'floor-second': 'Now a second corner along one edge (along a wall, say), and tap.',
    'floor-third': 'Now aim at the opposite edge and tap.',
  },
  base: {
    first: 'Plain wall: aim where the wall meets the floor, at one end, and tap.',
    'base-second': 'Now where it meets the floor at the other end, and tap.',
    'base-top': 'Now aim at the top of the wall (or as high as it is tiled) and tap.',
  },
};

export function startAr(root: HTMLElement): void {
  let doc: DesignDoc = openingDesign(new URLSearchParams(location.search));
  const textures = new TextureCache(catalog, () => {});
  const seriesName = (kind: 'wall' | 'floor') => catalog.series(doc[kind].layout.seriesId).name;

  // ---- The page before (and after) a session
  const support = h('p', { class: 'ar-support' }, 'Checking whether this phone can run AR…');
  const start = h('button', { type: 'button', class: 'pill-button primary', disabled: true }, 'Start AR');
  const report = h('pre', { class: 'ar-report', hidden: true });
  const design = h('p', { class: 'ar-design' });
  const showDesign = () => {
    design.textContent = `Wall: ${seriesName('wall')} · Floor: ${seriesName('floor')}. The size you mark and any changes are saved for the designer.`;
  };
  showDesign();
  const screen = h(
    'section',
    { class: 'ar-screen' },
    h('h1', {}, 'AR'),
    h(
      'p',
      {},
      'Mark a real wall or floor by its corners and see it tiled at its real size. Move the phone slowly over the surface first, until the ring appears on it. Drag on the tiles to slide the pattern.',
    ),
    design,
    support,
    h('div', { class: 'ar-actions' }, start, h('a', { class: 'pill-button', href: './?tab=count' }, 'Back to the designer')),
    report,
  );

  // ---- What shows over the camera during a session (WebXR's DOM overlay)
  const instruction = h('p', { class: 'ar-instruction' });
  const info = h('p', { class: 'ar-info', hidden: true });
  const status = h('pre', { class: 'ar-status' });
  const controls = h('div', { class: 'ar-controls' });
  const overlay = h('div', { class: 'ar-overlay', hidden: true }, h('div', { class: 'ar-top' }, instruction, info, status), controls);
  // Taps on the buttons mustn't also mark corners or drag.
  controls.addEventListener('beforexrselect', (event) => event.preventDefault());
  root.replaceChildren(screen, overlay);
  // The report of the last session, if there was one: still there after a crash and a reload.
  const previous = savedReport();
  if (previous) {
    report.hidden = false;
    report.textContent = [`Last session (${new Date(previous.at).toLocaleString()}):`, ...previous.lines].join('\n');
  }

  void checkArSupport().then((result) => {
    support.textContent = result.ok ? 'This phone can run AR.' : result.reason;
    support.classList.toggle('is-error', !result.ok);
    start.disabled = !result.ok;
    // For the browser check: the screen is up and knows whether AR can start.
    document.body.dataset.ready = 'true';
  });

  let nextAttempt = 0;
  start.addEventListener('click', () => void run());

  async function run(): Promise<void> {
    start.disabled = true;
    overlay.hidden = false;
    const started = await startArSession(overlay, nextAttempt);
    if (!('session' in started)) {
      overlay.hidden = true;
      start.disabled = false;
      report.hidden = false;
      report.textContent = ['Couldn’t start AR:', ...started.failures].join('\n');
      if (started.next !== null) {
        nextAttempt = started.next;
        support.textContent = 'Tap Start AR again to try with fewer features.';
      } else {
        nextAttempt = 0;
        support.textContent = 'AR didn’t start on this phone.';
      }
      return;
    }
    nextAttempt = 0;
    await session(started.session, started.attempt, started.failures);
  }

  async function session(xr: XRSession, attempt: string, failures: string[]): Promise<void> {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: true });
    if (!gl) {
      await xr.end();
      report.hidden = false;
      report.textContent = 'WebGL2 isn’t available, so nothing can be drawn.';
      return;
    }
    await gl.makeXRCompatible();
    const layer = new XRWebGLLayer(xr, gl);
    xr.updateRenderState({ baseLayer: layer });
    const room = await xr.requestReferenceSpace('local');
    const viewerSpace = await xr.requestReferenceSpace('viewer');
    const hitSource = xr.requestHitTestSource ? await xr.requestHitTestSource({ space: viewerSpace }) : null;
    const renderer = new ArRenderer(gl, textures);
    const features = xr.enabledFeatures ? [...xr.enabledFeatures] : null;
    const depth = xr.depthUsage ? ` (depth: ${xr.depthUsage}, ${xr.depthDataFormat})` : '';

    let mode: Mode = 'wall';
    let step: Step = { step: 'first' };
    /** The first corner's anchor, which the marked surface then rides on, and its latest pose. */
    let anchor: XRAnchor | null = null;
    let anchorPose: Float32Array | null = null;
    /** The tiled surface's placement relative to the anchor, once tiled. */
    let local: Float32Array | null = null;
    let result: LayoutResult | null = null;
    let resultPlan: unknown = null;
    let presetIndex = -1;
    let drag: { source: XRInputSource; from: Point; start: { origin: Point; overrides: DesignDoc['wall']['overrides']; tile: { w: number; h: number } }; doc: DesignDoc } | null = null;

    let viewer: Vec3 = [0, 0, 0];
    let aimRay: Ray | null = null;
    let aim: { kind: SurfaceKind; distance: number } | null = null;
    let tracking = 'starting';
    let message = '';
    let frames = 0;
    let fps = 0;
    let fpsFrom = 0;
    let shown = 0;
    let saved = 0;

    // ---- The design on the marked surface
    function layout(): LayoutResult | null {
      if (step.step !== 'tiled') return null;
      const plan = activePlan(doc);
      if (!result || resultPlan !== plan) {
        result = layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, catalog, { minCutFraction: doc.settings.minCutFraction });
        resultPlan = plan;
      }
      return result;
    }

    /** Keeps the design for the designer: the measured surface, series, preset and pattern. */
    function keepDesign(): void {
      writeStorage(DESIGN_KEY, serializeDesign(doc));
      showDesign();
    }

    function tile(surface: MarkedSurface): void {
      doc = act.setActive(doc, surface.kind);
      doc = act.setSurfaceSize(doc, surface.kind === 'wall' ? { widthMm: surface.widthMm, heightMm: surface.heightMm, tiledHeightMm: surface.heightMm } : { widthMm: surface.widthMm, heightMm: surface.heightMm });
      step = { step: 'tiled', surface };
      const model = surfaceToRoom(surface.frame, { x: 0, y: 0 });
      local = anchor && anchorPose ? multiply(invertPose(anchorPose), model) : null;
      presetIndex = -1;
      message = '';
      keepDesign();
      renderControls();
    }

    function restart(): void {
      // Anchors are let go of only while the session runs (decision 94).
      anchor?.delete();
      anchor = null;
      anchorPose = null;
      local = null;
      result = null;
      drag = null;
      step = { step: 'first' };
      renderer.keep([]);
      renderControls();
    }

    // ---- Buttons over the camera
    const button = (label: string, onclick: () => void, primary = false, pressed?: boolean) =>
      h('button', { type: 'button', class: `pill-button${primary ? ' primary' : ''}${pressed ? ' is-on' : ''}`, ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}), onclick }, label);

    function renderControls(): void {
      const exit = button('Exit AR', () => void xr.end(), true);
      const rows: HTMLElement[] = [];
      if (step.step === 'first') {
        rows.push(h('div', { class: 'ar-modes', role: 'group', 'aria-label': 'What to mark' }, ...MODES.map((m) => button(m.label, () => setMode(m.mode), false, mode === m.mode))));
        rows.push(h('div', { class: 'ar-row' }, exit));
      } else if (step.step === 'tiled') {
        const kind = step.surface.kind;
        const row = [button('Series', () => nextSeries(kind))];
        if (kind === 'wall') row.push(button('Preset', () => nextPreset()));
        row.push(button('Mark again', restart), exit);
        rows.push(h('div', { class: 'ar-row' }, ...row));
      } else {
        rows.push(h('div', { class: 'ar-row' }, button('Back', back), button('Start over', restart), exit));
      }
      controls.replaceChildren(...rows);
      updateText(true);
    }

    function setMode(next: Mode): void {
      mode = next;
      renderControls();
    }

    /** Takes back the last corner. */
    function back(): void {
      switch (step.step) {
        case 'floor-third':
          step = { step: 'floor-second', a: step.a, normal: step.normal };
          break;
        case 'base-top':
          step = { step: 'base-second', a: step.a };
          break;
        default:
          restart();
          return;
      }
      renderControls();
    }

    function nextSeries(kind: 'wall' | 'floor'): void {
      const list = catalog.seriesList(kind);
      const at = list.findIndex((s) => s.id === doc[kind].layout.seriesId);
      const next = list[(at + 1) % list.length];
      if (!next) return;
      doc = act.setSeries(doc, next.id, catalog);
      presetIndex = -1;
      message = `Series: ${next.name}`;
      keepDesign();
    }

    function nextPreset(): void {
      const presets = presetsFor(doc.wall.layout.seriesId, catalog);
      if (presets.length === 0) return;
      presetIndex = (presetIndex + 1) % presets.length;
      const { preset } = presets[presetIndex]!;
      doc = act.applyPreset(doc, preset.id, catalog);
      message = `Preset: ${preset.name}`;
      keepDesign();
    }

    // ---- Taps: mark the next corner (aiming with the ring in the middle of the screen)
    xr.addEventListener('select', (event: XRInputSourceEvent) => {
      try {
        markCorner(event.frame);
      } catch (error) {
        message = `That tap didn't work: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

    /** A short buzz: the tap registered. */
    const registered = () => navigator.vibrate?.(30);

    /**
     * Marks the next corner where the ring is. The aim is the last drawn frame's: a tap's own
     * frame can't give the phone's position (Chrome refuses it outside drawing, and an earlier
     * version lost every tap that way), but it can give the hit test, which the anchor needs.
     */
    function markCorner(eventFrame: XRFrame): void {
      if (step.step === 'tiled') return;
      const before = step;
      advance(eventFrame);
      if (step !== before) registered();
    }

    function advance(eventFrame: XRFrame): void {
      if (step.step === 'tiled') return;
      const ray = aimRay;
      if (!ray) {
        message = 'Not tracking yet: move the phone slowly.';
        return;
      }
      if (step.step === 'first') {
        const hit = hitSource ? eventFrame.getHitTestResults(hitSource)[0] : undefined;
        const pose = hit?.getPose(room);
        if (!hit || !pose) {
          message = 'No surface under the ring yet: move the phone slowly over it.';
          return;
        }
        const frame = surfaceFrame(pose.transform.matrix, viewer);
        const wanted = mode === 'wall' ? 'wall' : 'floor';
        if (frame.kind !== wanted) {
          message =
            mode === 'wall'
              ? `That's the ${frame.kind}, not a wall. If the ring won't land on the wall, try "Wall by its base".`
              : `That's a ${frame.kind}: aim at the floor.`;
          return;
        }
        message = '';
        // The surface rides on an anchor here, so it stays put as tracking improves.
        anchorPose = Float32Array.from(pose.transform.matrix);
        hit.createAnchor?.().then(
          (made) => {
            if (step.step === 'first') {
              made.delete();
              return;
            }
            anchor = made;
          },
          () => {},
        );
        if (mode === 'wall') step = { step: 'wall-second', first: frame };
        else if (mode === 'floor') step = { step: 'floor-second', a: frame.origin, normal: frame.normal };
        else step = { step: 'base-second', a: frame.origin };
        message = 'Corner marked.';
        renderControls();
        return;
      }
      const point = aimPoint(ray);
      if (!point) {
        message = 'Aim at the surface you are marking.';
        return;
      }
      if (step.step === 'wall-second') {
        const wall = wallFromCorners(step.first, point);
        if (wall) tile(wall);
        else message = 'Too small: aim further from the first corner.';
      } else if (step.step === 'floor-second') {
        step = { step: 'floor-third', a: step.a, b: point, normal: step.normal };
        message = 'Corner marked.';
        renderControls();
      } else if (step.step === 'floor-third') {
        const floor = floorFromCorners(step.a, step.b, point, step.normal);
        if (floor) tile(floor);
        else message = 'Too small: aim further from the first edge.';
      } else if (step.step === 'base-second') {
        const base = wallFromBase(step.a, point, viewer);
        if (base) {
          step = { step: 'base-top', a: step.a, base };
          message = 'Base marked.';
          renderControls();
        } else message = 'Too short: aim further along the wall.';
      } else if (step.step === 'base-top') {
        const wall = wallUpTo(step.base, point);
        if (wall) tile(wall);
        else message = 'Aim higher up the wall.';
      }
    }

    /** Where a ray meets the surface being marked (after its first corner). */
    function aimPoint(ray: Ray): Vec3 | null {
      switch (step.step) {
        case 'wall-second':
          return intersectPlane(ray, step.first.origin, step.first.normal);
        case 'floor-second':
        case 'floor-third':
          return intersectPlane(ray, step.a, step.normal);
        case 'base-second':
          return intersectPlane(ray, step.a, [0, 1, 0]);
        case 'base-top':
          return intersectPlane(ray, step.base.frame.origin, step.base.frame.normal);
        default:
          return null;
      }
    }

    // ---- Drags on the tiles: slide the pattern, as in the designer
    xr.addEventListener('selectstart', (event: XRInputSourceEvent) => {
      if (step.step !== 'tiled' || drag) return;
      try {
        // A touch's own ray, which a tap's frame can give (unlike the phone's position).
        const pose = event.frame.getPose(event.inputSource.targetRaySpace, room);
        const current = layout();
        const from = pose && surfaceMm(poseRay(pose.transform.matrix), step.surface.frame);
        if (!from || !current) return;
        drag = { source: event.inputSource, from, start: { origin: current.origin, overrides: activePlan(doc).overrides, tile: current.tile }, doc };
      } catch (error) {
        message = `That drag didn't work: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    xr.addEventListener('selectend', (event: XRInputSourceEvent) => {
      if (!drag || event.inputSource !== drag.source) return;
      drag = null;
      keepDesign();
    });

    function followDrag(frame: XRFrame): void {
      if (!drag || step.step !== 'tiled') return;
      // The touch may have ended between frames: its space then has no pose.
      const pose = frame.getPose(drag.source.targetRaySpace, room);
      const to = pose && surfaceMm(poseRay(pose.transform.matrix), step.surface.frame);
      if (!to) return;
      const raw = { x: drag.start.origin.x + to.x - drag.from.x, y: drag.start.origin.y + to.y - drag.from.y };
      doc = act.dragPattern(drag.doc, drag.start, raw, MAGNET_MM, catalog);
    }

    // ---- Each frame
    const onFrame = (time: number, frame: XRFrame) => {
      xr.requestAnimationFrame(onFrame);
      if (fpsFrom === 0) fpsFrom = time;
      frames++;
      if (time - fpsFrom >= 1000) {
        fps = Math.round((frames * 1000) / (time - fpsFrom));
        frames = 0;
        fpsFrom = time;
      }
      const pose = frame.getViewerPose(room);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!pose) {
        tracking = 'not tracking yet: move the phone slowly';
        updateText(false, time);
        return;
      }
      tracking = pose.emulatedPosition ? 'lost: move slowly, with more light or texture in view' : 'good';
      const p = pose.transform.position;
      viewer = [p.x, p.y, p.z];
      aimRay = poseRay(pose.transform.matrix);
      if (anchor) {
        const tracked = !frame.trackedAnchors || frame.trackedAnchors.has(anchor);
        const at = tracked ? frame.getPose(anchor.anchorSpace, room) : null;
        if (at) anchorPose = Float32Array.from(at.transform.matrix);
        // Tiled before the anchor arrived: ride on it from now on.
        if (at && step.step === 'tiled' && !local) local = multiply(invertPose(anchorPose!), surfaceToRoom(step.surface.frame, { x: 0, y: 0 }));
      }
      followDrag(frame);

      const rings: ArRing[] = [];
      const rects: ArRect[] = [];
      aim = null;
      if (step.step === 'first') {
        const hit = hitSource ? frame.getHitTestResults(hitSource)[0] : undefined;
        const hitPose = hit?.getPose(room);
        if (hitPose) {
          const m = hitPose.transform.matrix;
          const surface = surfaceFrame(m, viewer);
          aim = { kind: surface.kind, distance: Math.hypot(m[12]! - viewer[0], m[13]! - viewer[1], m[14]! - viewer[2]) };
          rings.push({ model: ringOn(surface, surface.origin, AIM_M), colour: COLOURS[surface.kind] });
        }
      } else if (step.step !== 'tiled') {
        const plane = markingFrame();
        const point = aimPoint(aimRay);
        for (const corner of markedCorners()) rings.push({ model: ringOn(plane, corner, CORNER_M), colour: COLOURS.mark });
        if (point) {
          rings.push({ model: ringOn(plane, point, AIM_M), colour: COLOURS[plane.kind] });
          aim = { kind: plane.kind, distance: Math.hypot(point[0] - viewer[0], point[1] - viewer[1], point[2] - viewer[2]) };
          const preview = previewTo(point);
          if (preview) rects.push({ model: rectOn(preview.frame, preview.frame.origin, preview.widthMm / 1000, preview.heightMm / 1000), size: [preview.widthMm / 1000, preview.heightMm / 1000], colour: COLOURS[preview.kind] });
        }
      }
      const current = layout();
      const patches = current && step.step === 'tiled' ? [{ result: current, model: local && anchorPose ? multiply(anchorPose, local) : surfaceToRoom(step.surface.frame, { x: 0, y: 0 }) }] : [];
      renderer.keep(patches);
      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        if (!viewport) continue;
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        renderer.draw(view.projectionMatrix, view.transform.inverse.matrix, { patches, rects, rings }, { groutMm: doc.settings.groutMm, groutColor: doc.settings.groutColor });
      }
      updateText(false, time);
    };

    /** The plane being marked, for drawing rings on it. */
    function markingFrame(): SurfaceFrame {
      switch (step.step) {
        case 'wall-second':
          return step.first;
        case 'base-top':
          return step.base.frame;
        case 'floor-second':
        case 'floor-third':
          return { kind: 'floor', origin: step.a, right: [1, 0, 0], up: [0, 0, -1], normal: step.normal };
        default:
          return { kind: 'floor', origin: [0, 0, 0], right: [1, 0, 0], up: [0, 0, -1], normal: [0, 1, 0] };
      }
    }

    function markedCorners(): Vec3[] {
      switch (step.step) {
        case 'wall-second':
          return [step.first.origin];
        case 'floor-second':
        case 'base-second':
          return [step.a];
        case 'floor-third':
          return [step.a, step.b];
        case 'base-top':
          return [step.base.frame.origin, wallFromBaseEnd(step.base)];
        default:
          return [];
      }
    }

    /** The far end of a wall's base. */
    function wallFromBaseEnd(base: { frame: SurfaceFrame; widthMm: number }): Vec3 {
      const { origin: o, right: r } = base.frame;
      const w = base.widthMm / 1000;
      return [o[0] + r[0] * w, o[1] + r[1] * w, o[2] + r[2] * w];
    }

    /** The surface the next tap would mark, to outline while aiming. */
    function previewTo(point: Vec3): MarkedSurface | null {
      switch (step.step) {
        case 'wall-second':
          return wallFromCorners(step.first, point);
        case 'floor-third':
          return floorFromCorners(step.a, step.b, point, step.normal);
        case 'base-top':
          return wallUpTo(step.base, point);
        default:
          return null;
      }
    }

    // ---- Text over the camera
    function statusLines(): string[] {
      return [
        `Tracking: ${tracking} · ${fps} fps`,
        `Aiming at: ${aim ? `${aim.kind}, ${aim.distance.toFixed(2)} m away` : 'nothing yet'}`,
        ...(message ? [message] : []),
      ];
    }

    const fullReport = () => [
      `Started with: ${attempt}`,
      `Features granted: ${features ? features.join(', ') : 'not reported by this browser'}${depth}`,
      ...statusLines(),
      ...(step.step === 'tiled' ? [summary(step.surface)] : []),
      ...(failures.length ? ['Tried first:', ...failures] : []),
    ];

    function summary(surface: MarkedSurface): string {
      const current = layout();
      const totals = current ? countTiles(current.pieces, doc.settings.allowancePct, catalog).totals : null;
      const kind = surface.kind === 'wall' ? 'Wall' : 'Floor';
      const plan = activePlan(doc);
      const size = `${(plan.surface.widthMm / 1000).toFixed(2)} × ${(plan.surface.heightMm / 1000).toFixed(2)} m`;
      return `${kind} ${size} · ${seriesName(surface.kind)}${totals ? ` · ${totals.tilesNeeded} tiles, ${totals.boxes} boxes` : ''}`;
    }

    function updateText(now: boolean, time = performance.now()): void {
      if (!now && time - shown < 250) return;
      shown = time;
      instruction.textContent = step.step === 'tiled' ? 'Drag on the tiles to slide the pattern.' : (INSTRUCTIONS[mode][step.step] ?? '');
      info.hidden = step.step !== 'tiled';
      if (step.step === 'tiled') info.textContent = summary(step.surface);
      status.textContent = statusLines().join('\n');
      // Kept on the phone every second, so a crash doesn't lose it.
      if (time - saved >= 1000) {
        saved = time;
        saveReport(fullReport());
      }
    }

    // When the session ends, the browser has already let go of its anchors and hit test, so they
    // aren't touched here: deleting them after the end crashed Chrome on a phone (decision 94).
    xr.addEventListener('end', () => {
      const lines = fullReport();
      saveReport(lines);
      overlay.hidden = true;
      start.disabled = false;
      report.hidden = false;
      report.textContent = ['Last session:', ...lines].join('\n');
    });
    renderControls();
    xr.requestAnimationFrame(onFrame);
  }
}

const REPORT_KEY = 'kt-ar-report';

/** The last session's report, kept on the phone (text only: no camera image is ever kept). */
function saveReport(lines: string[]): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify({ at: Date.now(), lines }));
  } catch {
    // Storage full or off: the report on screen still shows.
  }
}

function savedReport(): { at: number; lines: string[] } | null {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    const parsed = raw ? (JSON.parse(raw) as { at?: unknown; lines?: unknown }) : null;
    return parsed && typeof parsed.at === 'number' && Array.isArray(parsed.lines) ? { at: parsed.at, lines: parsed.lines.map(String) } : null;
  } catch {
    return null;
  }
}
