/**
 * Step 3a: the AR test screen (?view=ar). It starts an AR session on an Android phone, shows a
 * ring on the wall or floor the camera points at, and on a tap places a 1 m square of the saved
 * design there. On screen it reports what the phone supports and how tracking goes, so a
 * screenshot tells whether full AR tiling will work on it.
 */
import './ar.css';
import { catalog } from '../designs/catalog';
import { layoutSurface, type LayoutResult } from '../engine';
import { ArRenderer, type ArPatch, type ArReticle } from '../render/webgl/arRenderer';
import { TextureCache } from '../render/textureCache';
import type { DesignDoc } from '../state/document';
import { openingDesign } from '../ui/app';
import { h } from '../ui/dom';
import { invertPose, multiply, surfaceFrame, surfaceToRoom, type SurfaceKind, type Vec3 } from './surfaceFrame';
import { checkArSupport, startArSession } from './xrSession';

/** The square placed on a tap, in mm. */
const PATCH_MM = 1000;
/** The aiming ring's radius, in metres. */
const RING_M = 0.08;

const COLOURS: Record<SurfaceKind, [number, number, number]> = {
  wall: [31 / 255, 111 / 255, 235 / 255],
  floor: [245 / 255, 158 / 255, 11 / 255],
  ceiling: [0.6, 0.64, 0.7],
  slope: [0.6, 0.64, 0.7],
};

interface Placed extends ArPatch {
  kind: SurfaceKind;
  /** Kept in place by tracking, with the placement relative to it; absent where anchors aren't granted. */
  anchor: XRAnchor | null;
  local: Float32Array | null;
}

/** A square of the design as laid out for the wall or the floor. */
function patchLayout(doc: DesignDoc, kind: 'wall' | 'floor'): LayoutResult {
  const plan = kind === 'wall' ? doc.wall : doc.floor;
  const surface = kind === 'wall' ? { widthMm: PATCH_MM, heightMm: PATCH_MM, tiledHeightMm: PATCH_MM } : { widthMm: PATCH_MM, heightMm: PATCH_MM };
  return layoutSurface(surface, plan.layout, plan.alignment, {}, catalog, { minCutFraction: doc.settings.minCutFraction });
}

export function startAr(root: HTMLElement): void {
  const doc = openingDesign(new URLSearchParams(location.search));
  const textures = new TextureCache(catalog, () => {});
  const layouts = { wall: patchLayout(doc, 'wall'), floor: patchLayout(doc, 'floor') };
  const seriesName = (kind: 'wall' | 'floor') => catalog.series(doc[kind].layout.seriesId).name;

  // ---- The page before (and after) a session
  const support = h('p', { class: 'ar-support' }, 'Checking whether this phone can run AR…');
  const start = h('button', { type: 'button', class: 'pill-button primary', disabled: true }, 'Start AR');
  const report = h('pre', { class: 'ar-report', hidden: true });
  const screen = h(
    'section',
    { class: 'ar-screen' },
    h('h1', {}, 'AR test'),
    h(
      'p',
      {},
      'Point the camera at a wall or the floor and move the phone slowly until a ring appears on it. Tap to place a 1 m square of tiles there. Walk around: the tiles should stay put.',
    ),
    h('p', { class: 'ar-design' }, `Wall: ${seriesName('wall')} · Floor: ${seriesName('floor')} (your design from the designer)`),
    support,
    h('div', { class: 'ar-actions' }, start, h('a', { class: 'pill-button', href: './' }, 'Back to the designer')),
    report,
  );

  // ---- What shows over the camera during a session (WebXR's DOM overlay)
  const status = h('pre', { class: 'ar-status' });
  const undo = h('button', { type: 'button', class: 'pill-button' }, 'Undo');
  const clear = h('button', { type: 'button', class: 'pill-button' }, 'Clear');
  const exit = h('button', { type: 'button', class: 'pill-button primary' }, 'Exit AR');
  const controls = h('div', { class: 'ar-controls' }, undo, clear, exit);
  const overlay = h('div', { class: 'ar-overlay', hidden: true }, status, controls);
  // Taps on the buttons mustn't also place tiles.
  controls.addEventListener('beforexrselect', (event) => event.preventDefault());
  root.replaceChildren(screen, overlay);

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
    const look = { groutMm: doc.settings.groutMm, groutColor: doc.settings.groutColor };
    const features = xr.enabledFeatures ? [...xr.enabledFeatures] : null;
    const depth = xr.depthUsage ? ` (depth: ${xr.depthUsage}, ${xr.depthDataFormat})` : '';

    const placed: Placed[] = [];
    let aim: { kind: SurfaceKind; distance: number } | null = null;
    let tracking = 'starting';
    let planes = '';
    let message = '';
    let frames = 0;
    let fps = 0;
    let fpsFrom = 0;
    let shown = 0;
    let viewer: Vec3 = [0, 0, 0];

    undo.onclick = () => removePatches(placed.splice(-1));
    clear.onclick = () => removePatches(placed.splice(0));
    exit.onclick = () => void xr.end();

    function removePatches(gone: Placed[]): void {
      for (const patch of gone) patch.anchor?.delete();
      renderer.keep(placed);
    }

    xr.addEventListener('select', (event: XRInputSourceEvent) => {
      if (!hitSource) return;
      const hit = event.frame.getHitTestResults(hitSource)[0];
      const pose = hit?.getPose(room);
      if (!hit || !pose) {
        message = 'Nothing to place on yet: wait for the ring.';
        return;
      }
      const frame = surfaceFrame(pose.transform.matrix, viewer);
      if (frame.kind !== 'wall' && frame.kind !== 'floor') {
        message = `That looks like a ${frame.kind}: only walls and floors are tiled.`;
        return;
      }
      const model = surfaceToRoom(frame, { x: PATCH_MM / 2, y: PATCH_MM / 2 });
      const patch: Placed = { kind: frame.kind, result: layouts[frame.kind], model, anchor: null, local: null };
      placed.push(patch);
      message = `Placed on the ${frame.kind}.`;
      // An anchor keeps the square where it was put as tracking improves; the placement is kept relative to it.
      if (hit.createAnchor) {
        const hitPose = Float32Array.from(pose.transform.matrix);
        hit.createAnchor().then(
          (anchor) => {
            if (!placed.includes(patch)) {
              anchor.delete();
              return;
            }
            patch.anchor = anchor;
            patch.local = multiply(invertPose(hitPose), model);
          },
          (error: unknown) => {
            message = `Placed, but without an anchor (${error instanceof Error ? error.message : String(error)}).`;
          },
        );
      }
    });

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
        updateStatus(time);
        return;
      }
      tracking = pose.emulatedPosition ? 'lost: move slowly, with more light or texture in view' : 'good';
      const p = pose.transform.position;
      viewer = [p.x, p.y, p.z];

      let reticle: ArReticle | null = null;
      aim = null;
      const hit = hitSource ? frame.getHitTestResults(hitSource)[0] : undefined;
      const hitPose = hit?.getPose(room);
      if (hitPose) {
        const m = hitPose.transform.matrix;
        const surface = surfaceFrame(m, viewer);
        aim = { kind: surface.kind, distance: Math.hypot(m[12]! - viewer[0], m[13]! - viewer[1], m[14]! - viewer[2]) };
        const ring = Float32Array.from(m);
        for (let i = 0; i < 12; i++) ring[i]! *= RING_M;
        reticle = { model: ring, colour: COLOURS[surface.kind] };
      }
      for (const patch of placed) {
        if (!patch.anchor || !patch.local || (frame.trackedAnchors && !frame.trackedAnchors.has(patch.anchor))) continue;
        const anchorPose = frame.getPose(patch.anchor.anchorSpace, room);
        if (anchorPose) patch.model = multiply(anchorPose.transform.matrix, patch.local);
      }
      if (frame.detectedPlanes) {
        let walls = 0;
        let level = 0;
        for (const plane of frame.detectedPlanes) {
          if (plane.orientation === 'vertical') walls++;
          else level++;
        }
        planes = `${walls} upright, ${level} level`;
      }
      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        if (!viewport) continue;
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        renderer.draw(view.projectionMatrix, view.transform.inverse.matrix, placed, reticle, look);
      }
      updateStatus(time);
    };

    function statusLines(): string[] {
      const anchored = placed.filter((p) => p.anchor).length;
      return [
        `Started with: ${attempt}`,
        `Features granted: ${features ? features.join(', ') : 'not reported by this browser'}${depth}`,
        `Overlay: ${xr.domOverlayState?.type ?? 'none'}`,
        `Tracking: ${tracking}`,
        `Aiming at: ${aim ? `${aim.kind}, ${aim.distance.toFixed(2)} m away` : 'nothing yet: move the phone slowly over the surface'}`,
        `Surfaces found: ${planes || 'not reported (no plane detection)'}`,
        `Placed: ${placed.length} (${anchored} anchored)`,
        `Frame rate: ${fps} fps`,
        ...(message ? [message] : []),
      ];
    }

    function updateStatus(time: number): void {
      if (time - shown < 250) return;
      shown = time;
      status.textContent = statusLines().join('\n');
    }

    xr.addEventListener('end', () => {
      hitSource?.cancel();
      for (const patch of placed) patch.anchor?.delete();
      overlay.hidden = true;
      start.disabled = false;
      report.hidden = false;
      report.textContent = ['Last session:', ...statusLines(), ...(failures.length ? ['Tried first:', ...failures] : [])].join('\n');
    });
    xr.requestAnimationFrame(onFrame);
  }
}
