// Pages and interactions the browser check visits. `path` is relative to the base URL; `run`
// can interact with the page, assert (throw) and take screenshots with shot(label).
// Pages opened with ?debug=1 expose window.ktDebug for reading state and coordinates.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.ktDebug.state();
    return { doc: s.doc, ui: s.ui, canUndo: s.canUndo, canRedo: s.canRedo };
  });

/**
 * Waits until the app state passes `check`, since a tap's click and the redraw arrive a moment
 * after the input events. Fails with `message` (and what it saw) after two seconds.
 */
async function expectState(page, check, message, show = (s) => s.doc[s.doc.active].overrides) {
  let last;
  for (const started = Date.now(); Date.now() - started < 2000; await pause(40)) {
    last = await state(page);
    if (check(last)) return last;
  }
  throw new Error(`Assertion failed: ${message} (saw ${JSON.stringify(show(last))})`);
}

const screenOf = (page, x, y) => page.evaluate(([px, py]) => window.ktDebug.screen(px, py), [x, y]);
const viewScale = (page) => page.evaluate(() => window.ktDebug.view().scale);
const fittedScale = (page) => page.evaluate(() => window.ktDebug.fittedScale());
const pct = (share) => `${Math.round(share * 100)}%`;
const surfacesOf = (page) => page.evaluate(() => window.ktDebug.surfaces());
/** Taps the deepest point of the largest region with a label (1 wall, 2 floor). */
async function tapLabel(page, device, label) {
  const point = await page.evaluate((l) => window.ktDebug.labelPoint(l), label);
  assert(point, `a region labelled ${label} to tap`);
  const input = await pointer(page, device);
  await input.tap(await photoScreen(page, point.x, point.y));
}
/** Photo points inside a quad, well clear of label edges: on the wall (label 1) and on fixtures (label 0). */
const pointsInQuad = (page, quad) =>
  page.evaluate((q) => {
    const inside = (p) => {
      let right = 0;
      for (let i = 0; i < 4; i++) {
        let a = q[i];
        let b = q[(i + 1) % 4];
        if (a.y > p.y === b.y > p.y) continue;
        if (a.y > b.y) [a, b] = [b, a];
        if (a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x) > p.x) right++;
      }
      return right % 2 === 1;
    };
    const { width, height } = window.ktDebug.photo();
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    const found = { wall: [], other: [] };
    for (let y = Math.max(0, Math.min(...ys)); y < Math.min(height, Math.max(...ys)); y += 24) {
      for (let x = Math.max(0, Math.min(...xs)); x < Math.min(width, Math.max(...xs)); x += 24) {
        const near = [[0, 0], [-16, 0], [16, 0], [0, -16], [0, 16]].map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
        if (!near.every(inside)) continue;
        const labels = near.map((p) => window.ktDebug.labelAt(p.x, p.y));
        if (labels.every((l) => l === 1)) found.wall.push({ x, y });
        if (labels.every((l) => l === 0)) found.other.push({ x, y });
      }
    }
    return found;
  }, quad);
const alphaAt = async (page, p) => (await page.evaluate(([x, y]) => window.ktDebug.tilePixel(x, y), [p.x, p.y]))[3];

/** Width and height from a PNG's header. */
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
/** Opens the sample, tiles its wall, and returns once the tiles are drawn. */
async function tileTheWall(page, device) {
  await segmented(page, 'Old bathroom with subway tiles');
  await tapLabel(page, device, 1);
  await page.waitForFunction(() => window.ktDebug.surfaces().length >= 1, null, { timeout: 3000 });
  await press(page, device, '.fit-card button:text-is("Done")');
  await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
}
/** Whether leaving the page would ask first (the beforeunload handler cancels the event). */
const asksBeforeLeaving = (page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

/** Opens a sheet tab (on the phone this also unfolds the sheet). One press is enough: a second would fold it. */
async function openTab(page, device, name) {
  const body = page.locator(`.tab-${name.toLowerCase()}`);
  if (await body.isVisible()) return;
  await press(page, device, `.sheet-tab:text-is("${name}")`);
  await body.waitFor({ state: 'visible', timeout: 2000 });
}
/** Waits for a photo to be open and its walls found (the first run downloads the model), and returns the result. */
async function segmented(page, name) {
  await page.waitForFunction(
    (t) => window.ktDebug.photo()?.name === t && ['ready', 'failed'].includes(window.ktDebug.segmentation().state),
    name,
    { timeout: 180000 },
  );
  const result = await page.evaluate(() => window.ktDebug.segmentation());
  assert(result.state === 'ready', `${name}: walls found (${result.message ?? result.state})`);
  return result;
}
/** A photo pixel in page coordinates (photo mode). */
const photoScreen = (page, x, y) => page.evaluate(([px, py]) => window.ktDebug.photoScreen(px, py), [x, y]);
/** Centre of a placed piece, in page coordinates. */
const pieceCentre = (page, col, row) =>
  page.evaluate(
    ([c, r]) => {
      const piece = window.ktDebug.result().pieces.find((p) => p.cell.col === c && p.cell.row === r);
      if (!piece) return null;
      const v = piece.visibleRect;
      return window.ktDebug.screen(v.x + v.w / 2, v.y + v.h / 2);
    },
    [col, row],
  );
const bandLabels = (page) => page.locator('.band-label').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

/** One pointer: the mouse on desktop, a finger (real touch events) on the phone. */
async function pointer(page, device) {
  if (device === 'desktop') {
    return {
      down: async (p) => {
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
      },
      move: (p, steps = 8) => page.mouse.move(p.x, p.y, { steps }),
      up: () => page.mouse.up(),
      tap: (p) => page.mouse.click(p.x, p.y),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  let last = null;
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    down: async (p) => {
      last = p;
      await send('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
    },
    move: async (p, steps = 8) => {
      const from = last ?? p;
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps, id: 1 }]);
      }
      last = p;
    },
    up: () => send('touchEnd', []),
    tap: async (p) => {
      await send('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
      await send('touchEnd', []);
    },
    /** Two fingers moving apart (factor > 1) around a point. */
    pinch: async (centre, startGap, factor, steps = 10) => {
      const at = (gap) => [
        { x: centre.x - gap / 2, y: centre.y, id: 1 },
        { x: centre.x + gap / 2, y: centre.y, id: 2 },
      ];
      await send('touchStart', at(startGap));
      for (let i = 1; i <= steps; i++) await send('touchMove', at(startGap * (1 + ((factor - 1) * i) / steps)));
      await send('touchEnd', []);
    },
  };
}

const press = (page, device, selector) => (device === 'phone' ? page.locator(selector).tap() : page.locator(selector).click());
const alignX = (s) => s.doc.wall.alignment.x;

/**
 * A stand-in for WebXR, run in the page before the app (headless Chrome has no AR): a room with a
 * wall 2 m ahead (z = −2, facing the camera) and the floor (y = 0), and a camera 1.5 m up that
 * `__fakeXr.aimAt([x, y, z])` turns towards a point. Hit tests find the nearest of the wall and the
 * floor along the camera's ray. `select()` taps; `touchAt(point)`, `selectstart()` and `selectend()`
 * drag a finger. Its layer draws into the app's own canvas, shown in a corner, and after each
 * frame it reads back the pixel in the middle and one near the top (`__fakeXr.pixels`).
 */
function fakeWebXr() {
  const W = 600;
  const H = 800;
  const near = 0.05;
  const far = 100;
  const f = 1 / Math.tan(Math.PI / 6);
  const projection = new Float32Array([f / (W / H), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  const eye = [0, 1.5, 0];
  const state = { gl: null, session: null, init: null, anchors: new Map(), pixels: {}, camera: null, view: null, touch: null };
  window.__fakeXr = state;
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  /** A pose at `from` with its −z axis towards `to`, and its inverse (for a view matrix). */
  const lookAt = (from, to) => {
    const forward = norm(to.map((c, i) => c - from[i]));
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const m = new Float32Array([...right, 0, ...up, 0, ...forward.map((c) => -c), 0, ...from, 1]);
    const inverse = new Float32Array(16);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) inverse[c * 4 + r] = m[r * 4 + c];
    for (let r = 0; r < 3; r++) inverse[12 + r] = -(inverse[r] * from[0] + inverse[4 + r] * from[1] + inverse[8 + r] * from[2]);
    inverse[15] = 1;
    return { m, inverse };
  };
  state.aimAt = (to) => {
    const { m, inverse } = lookAt(eye, to);
    state.camera = m;
    state.view = inverse;
  };
  state.aimAt([0, 1.5, -2]);
  state.touchAt = (to) => {
    state.touch = to ? lookAt(eye, to).m : null;
  };
  const planes = [
    { point: [0, 0, -2], normal: [0, 0, 1] },
    { point: [0, 0, 0], normal: [0, 1, 0] },
  ];
  /** The nearest surface along a pose's ray, as WebXR gives it: y along the normal. */
  const hitFrom = (m) => {
    const o = [m[12], m[13], m[14]];
    const d = [-m[8], -m[9], -m[10]];
    let best = null;
    for (const plane of planes) {
      const facing = d[0] * plane.normal[0] + d[1] * plane.normal[1] + d[2] * plane.normal[2];
      if (Math.abs(facing) < 1e-6) continue;
      const t = ((plane.point[0] - o[0]) * plane.normal[0] + (plane.point[1] - o[1]) * plane.normal[1] + (plane.point[2] - o[2]) * plane.normal[2]) / facing;
      if (t > 0 && (!best || t < best.t)) best = { t, plane };
    }
    if (!best) return null;
    const at = o.map((c, i) => c + d[i] * best.t);
    const n = best.plane.normal;
    const x = [1, 0, 0];
    return new Float32Array([...x, 0, ...n, 0, ...cross(x, n), 0, ...at, 1]);
  };
  const pose = (matrix, inverse = matrix) => ({ emulatedPosition: false, transform: { matrix, position: { x: matrix[12], y: matrix[13], z: matrix[14] }, inverse: { matrix: inverse } } });
  const touchSpace = {};
  const inputSource = { targetRayMode: 'screen', targetRaySpace: touchSpace };
  // As in Chrome, only frames handed to requestAnimationFrame can give the phone's position; a
  // tap's frame refuses (an earlier version lost every tap to this on a real phone).
  const frame = (session, animation) => ({
    session,
    getViewerPose: () => {
      if (!animation) throw new DOMException('getViewerPose can only be called on frames passed to a callback of requestAnimationFrame()', 'InvalidStateError');
      return { ...pose(state.camera, state.view), views: [{ eye: 'none', projectionMatrix: projection, transform: { inverse: { matrix: state.view } } }] };
    },
    getHitTestResults: () => {
      const m = hitFrom(state.camera);
      if (!m) return [];
      return [
        {
          getPose: () => pose(m),
          createAnchor: () => {
            const anchor = { anchorSpace: {}, delete: () => state.anchors.delete(anchor) };
            state.anchors.set(anchor, m);
            return Promise.resolve(anchor);
          },
        },
      ];
    },
    getPose: (space) => {
      if (space === touchSpace) return state.touch ? pose(state.touch) : null;
      for (const [anchor, m] of state.anchors) if (anchor.anchorSpace === space) return pose(m);
      return null;
    },
    trackedAnchors: new Set(state.anchors.keys()),
    detectedPlanes: new Set([{ orientation: 'vertical' }, { orientation: 'horizontal' }]),
  });
  class FakeSession extends EventTarget {
    enabledFeatures = ['hit-test', 'dom-overlay', 'anchors', 'plane-detection'];
    domOverlayState = { type: 'screen' };
    ended = false;
    updateRenderState() {}
    requestReferenceSpace() {
      return Promise.resolve({});
    }
    requestHitTestSource() {
      return Promise.resolve({ cancel() {} });
    }
    requestAnimationFrame(callback) {
      setTimeout(() => {
        if (this.ended) return;
        callback(performance.now(), frame(this, true));
        const gl = state.gl;
        const read = (x, y) => {
          const out = new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
          return Array.from(out);
        };
        state.pixels = { centre: read(W / 2, H / 2), top: read(W / 2, H - 30) };
      }, 16);
      return 1;
    }
    end() {
      this.ended = true;
      this.dispatchEvent(new Event('end'));
      return Promise.resolve();
    }
    fire(type) {
      const event = new Event(type);
      event.frame = frame(this, false);
      event.inputSource = inputSource;
      this.dispatchEvent(event);
    }
    select() {
      this.fire('select');
    }
    selectstart() {
      this.fire('selectstart');
    }
    selectend() {
      this.fire('selectend');
      this.fire('select');
    }
  }
  window.XRWebGLLayer = class {
    constructor(session, gl) {
      state.gl = gl;
      gl.canvas.width = W;
      gl.canvas.height = H;
      gl.canvas.style.cssText = 'position:fixed;right:8px;bottom:120px;width:240px;height:320px;pointer-events:none;outline:1px solid #999';
      document.body.append(gl.canvas);
      this.framebuffer = null;
    }
    getViewport() {
      return { x: 0, y: 0, width: W, height: H };
    }
  };
  WebGL2RenderingContext.prototype.makeXRCompatible = () => Promise.resolve();
  const xr = {
    isSessionSupported: (mode) => Promise.resolve(mode === 'immersive-ar'),
    requestSession: (_mode, init) => {
      state.init = init;
      state.session = new FakeSession();
      return Promise.resolve(state.session);
    },
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
}

export const scenarios = [
  // ---- Static rendering (step 2)
  { name: 'opening-wall', path: './' },
  { name: 'sprig-joint', path: './?zoom=5&cx=1200&cy=1800&motifs=1' },
  { name: 'medallion-joint', path: './?series=demo-azure-medallion&preset=feature-wall&w=2450&x=centre-motif&zoom=4&cx=1225&cy=1500&motifs=1' },
  { name: 'floor-checker', path: './?surface=floor&design=floor-checker&w=1800&h=2450&x=centre-tile&y=centre-tile&repeat=1' },

  // ---- Pattern mode: drag with snapping and live labels, then undo
  {
    name: 'pattern-drag',
    path: './?debug=1',
    async run(page, { device, shot }) {
      const start = await state(page);
      assert(alignX(start).mode === 'centre-between-motifs', 'opens on the top suggestion: between motifs');
      const scale = await viewScale(page);
      const from = await screenOf(page, 1200, 1100);
      const input = await pointer(page, device);
      await input.down(from);
      await input.move({ x: from.x + 75 * scale, y: from.y });
      await shot('mid-drag');
      await input.move({ x: from.x + 150 * scale, y: from.y });
      await input.up();
      await expectState(page, (s) => alignX(s).mode === 'centre-motif' && s.canUndo, '150 mm to the right snaps to centre-motif', alignX);
      await shot('after');
      await press(page, device, 'button[aria-label="Undo"]');
      await expectState(page, (s) => alignX(s).mode === 'centre-between-motifs' && !s.canUndo, 'undo restores it, and the whole drag was one step', alignX);
      await press(page, device, 'button[aria-label="Redo"]');
      await expectState(page, (s) => alignX(s).mode === 'centre-motif', 'redo re-applies it', alignX);
    },
  },

  // ---- Row mode: height ranges, +/−, drag to reorder, tap to change design
  {
    name: 'row-mode',
    path: './?debug=1&mode=row',
    async run(page, { device, shot }) {
      const bands = (s) => s.doc.wall.layout.bands;
      const labels = await bandLabels(page);
      assert(labels.includes('Highlighter pair: 1350–2250 mm'), `band ranges shown, got ${labels.join(' | ')}`);
      await shot('handles');
      await press(page, device, '.band-handle >> nth=1 >> button[aria-label^="More rows"]');
      await expectState(page, (s) => bands(s)[1].rows === 3, 'plus adds a row to the Light band', bands);
      await pause(100);
      assert((await bandLabels(page)).includes('Highlighter pair: 1800–2700 mm'), 'ranges update');

      const grip = await page.locator('.band-handle').nth(2).locator('.band-grip').boundingBox();
      const floor = await screenOf(page, 0, 0);
      const input = await pointer(page, device);
      const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await input.down(from);
      await input.move({ x: from.x, y: floor.y - 10 }, 12);
      await shot('reordering');
      await input.up();
      await expectState(page, (s) => bands(s)[0].designId === 'ivory-hl-pair', 'highlighter dragged down to the floor', bands);
      await shot('reordered');

      await press(page, device, '.band-handle >> nth=0 >> .band-label');
      await page.locator('.design-popover').waitFor({ state: 'visible', timeout: 2000 });
      await shot('design-picker');
      await press(page, device, '.design-popover .design-choice >> nth=1');
      await expectState(page, (s) => bands(s)[0].designId === 'ivory-dark-plain', 'picking a design changes the band', bands);
    },
  },

  // ---- Tile mode: select, rotate (180° only for rectangles), hold-and-drag to swap, reset
  {
    name: 'tile-mode',
    path: './?debug=1&mode=tile',
    async run(page, { device, shot }) {
      const overrides = (s) => s.doc.wall.overrides;
      const input = await pointer(page, device);
      const hl = await pieceCentre(page, 3, 3);
      await input.tap(hl);
      await expectState(page, (s) => s.ui.selectedCell?.col === 3 && s.ui.selectedCell?.row === 3, 'the first tap selects the tile', (s) => s.ui.selectedCell);
      await pause(350);
      await input.tap(hl);
      await expectState(page, (s) => overrides(s)['3,3']?.rotation === 180, 'the second tap turns it 180°');
      await pause(350);
      await input.tap(hl);
      await expectState(page, (s) => !overrides(s)['3,3'], 'a rectangle goes 180° → 0°, never 90°');

      const light = await pieceCentre(page, 3, 1);
      await input.down(hl);
      await pause(650);
      await input.move({ x: (hl.x + light.x) / 2, y: (hl.y + light.y) / 2 }, 6);
      await shot('carrying');
      await input.move(light, 6);
      await input.up();
      await expectState(page, (s) => overrides(s)['3,1']?.tileId === 'ivory-hl-b' && overrides(s)['3,3']?.tileId === 'ivory-light', 'hold and drag swaps two tiles');
      await shot('swapped');
      await press(page, device, 'button:has-text("Reset tiles")');
      await expectState(page, (s) => Object.keys(overrides(s)).length === 0, 'Reset tiles clears the overrides');
    },
  },

  // ---- Zoom and fit: wheel on desktop, pinch on the phone, double-tap to fit
  {
    name: 'zoom',
    path: './?debug=1',
    async run(page, { device, shot }) {
      const fit = await fittedScale(page);
      const centre = await screenOf(page, 1200, 1350);
      if (device === 'desktop') {
        await page.mouse.move(centre.x, centre.y);
        await page.mouse.wheel(0, -600);
      } else {
        const input = await pointer(page, device);
        await input.pinch(centre, 80, 2.5);
      }
      await pause(120);
      const zoomed = await viewScale(page);
      assert(zoomed > fit * 1.5, `zoomed in (${fit.toFixed(3)} → ${zoomed.toFixed(3)})`);
      await shot('zoomed');
      const input = await pointer(page, device);
      await input.tap(centre);
      await pause(60);
      await input.tap(centre);
      await pause(150);
      const back = await viewScale(page);
      assert(Math.abs(back - fit) < 1e-6, `double-tap fits again (${back.toFixed(3)} vs ${fit.toFixed(3)})`);
    },
  },

  // ---- Design tab: presets with previews, series, band list
  {
    name: 'design-tab',
    path: './?debug=1&tab=design',
    async run(page, { device, shot }) {
      const bands = (s) => s.doc.wall.layout.bands.map((b) => `${b.designId}:${b.rows}`);
      await page.locator('.preset-choice').first().waitFor({ state: 'visible', timeout: 3000 });
      await shot('');
      await press(page, device, '.preset-choice:has-text("Classic")');
      await expectState(page, (s) => bands(s).join() === 'ivory-dark-plain:2,ivory-light-plain:fill', 'Classic preset applied', bands);
      await press(page, device, '.preset-choice:has-text("Highlighter band")');
      await press(page, device, '.series-choice:has-text("Azure")');
      await expectState(page, (s) => s.doc.wall.layout.seriesId === 'demo-azure-medallion' && bands(s)[2] === 'azure-medallion-2x2:2', 'series switched, bands kept role for role', bands);
      // Band list: top band first. Move the medallion band (third row from the top... index 2) up one.
      await press(page, device, 'button[aria-label="Move Medallion up"]');
      await expectState(page, (s) => bands(s)[3] === 'azure-medallion-2x2:fill', 'medallion moved to the top and took over "fill"', bands);
      await press(page, device, 'button[aria-label="Undo"]');
      await press(page, device, '.band-row >> nth=1 >> button[aria-label^="More rows"]');
      await expectState(page, (s) => bands(s)[2] === 'azure-medallion-2x2:4', 'band list + adds a repeat unit', bands);
      await shot('azure');
    },
  },

  // ---- Tiles tab: assign to the selected band or the selected tile
  {
    name: 'tiles-tab',
    path: './?debug=1&tab=tiles',
    async run(page, { device, shot }) {
      await page.locator('.tile-choice').first().waitFor({ state: 'visible', timeout: 3000 });
      assert((await page.locator('.tab-tiles .tab-heading').allTextContents()).join() === 'Light,Dark,Highlighter', 'tiles grouped by role');
      await shot('');
      await press(page, device, '.sheet-tab:has-text("Design")');
      await press(page, device, '.band-row >> nth=2 >> .band-info'); // Light, 450–1350 mm
      await press(page, device, '.sheet-tab:has-text("Tiles")');
      await press(page, device, '.tile-choice:has-text("Dark")');
      await expectState(page, (s) => s.doc.wall.layout.bands[1].designId === 'ivory-dark-plain', 'tapping a tile assigns it to the selected band', (s) => s.doc.wall.layout.bands);
      await press(page, device, '.mode-switch button:has-text("Tile")');
      const input = await pointer(page, device);
      await input.tap(await pieceCentre(page, 4, 5));
      await expectState(page, (s) => s.ui.selectedCell?.row === 5, 'a tile is selected', (s) => s.ui.selectedCell);
      await press(page, device, '.tile-choice:has-text("HL-A")');
      await expectState(page, (s) => s.doc.wall.overrides['4,5']?.tileId === 'ivory-hl-a', 'tapping a tile replaces the selected tile');
      await shot('assigned');
    },
  },

  // ---- Align tab: the medallion trade-off on a 2450 mm wall, and the priority toggle
  {
    name: 'align-tab',
    path: './?debug=1&tab=align&series=demo-azure-medallion&w=2450&x=left',
    async run(page, { device, shot }) {
      const minCut = await page.locator('.range-value').textContent();
      assert(minCut === '33% of a tile: 100 mm', `the default minimum cut is a third of a tile, got "${minCut}"`);
      await press(page, device, 'button:has-text("Suggest alignment")');
      await page.locator('.suggestion').first().waitFor({ state: 'visible', timeout: 3000 });
      const read = () => page.locator('.suggestion').evaluateAll((els) => els.map((el) => [el.querySelector('.suggestion-label')?.firstChild?.textContent, el.querySelector('.suggestion-text')?.textContent]));
      let list = await read();
      assert(
        list[0]?.[0] === 'Centre tile' && list[0]?.[1] === '3 whole medallions + 2 cut at the edges, 175 mm cuts at both ends, not symmetric',
        `avoid slivers ranks centre-tile first, got ${JSON.stringify(list[0])}`,
      );
      assert(
        list.some(([label, text]) => label === 'Centre motif' && text === '3 whole medallions + 2 cut at the edges, 25 mm slivers at both ends, symmetric'),
        'the centred-motif option shows its slivers',
      );
      await shot('suggestions');
      await press(page, device, '.priority button:has-text("Symmetric pattern")');
      await expectState(page, (s) => s.doc.settings.suggestPriority === 'symmetric', 'priority switched', (s) => s.doc.settings);
      await pause(150);
      list = await read();
      assert(list[0]?.[0] === 'Centre motif' && list[1]?.[0] === 'Between motifs', `symmetric options first, got ${JSON.stringify(list.slice(0, 2))}`);
      await press(page, device, '.suggestion >> nth=0');
      await expectState(page, (s) => s.doc.wall.alignment.x.mode === 'centre-motif', 'tapping a suggestion applies it', (s) => s.doc.wall.alignment);
      await shot('applied');
      await press(page, device, '.option:has-text("Right")');
      await expectState(page, (s) => s.doc.wall.alignment.x.mode === 'right', 'alignment buttons apply', (s) => s.doc.wall.alignment);
    },
  },

  // ---- Count tab: the numbers from the required engine tests
  {
    name: 'count-tab',
    path: './?debug=1&tab=count&design=ivory-light-plain&x=left',
    async run(page, { device, shot }) {
      const row = () => page.locator('.count-table tbody tr').first().locator('td').allTextContents();
      await page.locator('.count-table').waitFor({ state: 'visible', timeout: 3000 });
      let cells = await row();
      assert(cells.join() === '48,0,48,51,7', `left: 48 full, 51 tiles, 7 boxes; got ${cells}`);
      await shot('left');
      await press(page, device, '.sheet-tab:has-text("Align")');
      await press(page, device, '.option:has-text("Centre tile")');
      await press(page, device, '.sheet-tab:has-text("Count")');
      await pause(150);
      cells = await row();
      assert(cells.join() === '42,12,54,57,8', `centre-tile: 42 full, 12 cut, 57 tiles, 8 boxes; got ${cells}`);
      const allowance = page.locator('.tab-count input[type="number"]');
      await allowance.fill('10');
      await allowance.press('Enter');
      await expectState(page, (s) => s.doc.settings.allowancePct === 10, 'allowance edited', (s) => s.doc.settings);
      await pause(150);
      cells = await row();
      assert(cells[3] === '60', `54 pieces + 10% = 60 tiles; got ${cells}`);
      assert((await page.locator('.summary-value').textContent()).includes('6.48 m²'), 'area shown in m²');
      await shot('centre-tile');
    },
  },

  // ---- Floor mode: floor series and tiles only, both axes, square tiles turn 90°
  {
    name: 'floor-mode',
    path: './?debug=1&tab=design',
    async run(page, { device, shot }) {
      const wallBefore = (await state(page)).doc.wall;
      await press(page, device, '.surface-toggle >> text=Floor');
      await expectState(page, (s) => s.doc.active === 'floor', 'floor shown', (s) => s.doc.active);
      await pause(150);
      const series = await page.locator('.series-choice .series-name').allTextContents();
      assert(series.join() === 'Demo Floor', `only floor series offered, got ${series}`);
      await press(page, device, '.design-choice:has-text("Checkerboard")');
      await expectState(page, (s) => s.doc.floor.layout.designId === 'floor-checker', 'checkerboard chosen', (s) => s.doc.floor.layout);
      await shot('checkerboard');

      await press(page, device, '.sheet-tab:has-text("Tiles")');
      await pause(150);
      const groups = await page.locator('.tab-tiles .tab-heading').allTextContents();
      const tiles = await page.locator('.tab-tiles .tile-name').allTextContents();
      assert(groups.join() === 'Floor tiles' && tiles.join() === 'Grey anti-skid,Beige anti-skid', `floor tiles only, got ${groups} / ${tiles}`);

      // Pattern drag moves both axes; 150 mm right and 150 mm up lands on centre-tile both ways.
      await press(page, device, '.sheet-tab:has-text("Design")');
      await press(page, device, '.design-choice:has-text("Grey")');
      await expectState(page, (s) => s.doc.floor.layout.designId === 'floor-grey-plain', 'grey floor', (s) => s.doc.floor.layout);
      const scale = await viewScale(page);
      const from = await screenOf(page, 900, 1200);
      const input = await pointer(page, device);
      await input.down(from);
      await input.move({ x: from.x + 150 * scale, y: from.y - 150 * scale }, 10);
      await shot('dragging');
      await input.up();
      await expectState(
        page,
        (s) => s.doc.floor.alignment.x.mode === 'centre-tile' && s.doc.floor.alignment.y.mode === 'centre-tile',
        'floor drag snaps on both axes',
        (s) => s.doc.floor.alignment,
      );

      await press(page, device, '.sheet-tab:has-text("Align")');
      await press(page, device, 'button:has-text("Suggest alignment")');
      await page.locator('.suggestion').first().waitFor({ state: 'visible', timeout: 3000 });
      const labels = await page.locator('.suggestion-label').allTextContents();
      assert(labels.some((l) => l.includes('both ways')) && labels.some((l) => l.includes('across')), `floor suggestions cover both axes, got ${labels.slice(0, 4)}`);

      await press(page, device, '.mode-switch button:has-text("Tile")');
      const cell = await pieceCentre(page, 2, 2);
      await input.tap(cell);
      await pause(350);
      await input.tap(cell);
      await expectState(page, (s) => s.doc.floor.overrides['2,2']?.rotation === 90, 'square floor tiles turn 90°', (s) => s.doc.floor.overrides);

      await press(page, device, '.sheet-tab:has-text("Count")');
      await pause(150);
      const total = await page.locator('.count-table tfoot td').allTextContents();
      assert(total.join() === '35,28,63,67,7', `1800 × 2400 floor, centre-tile both ways: 35 full + 28 cut, 67 tiles, 7 boxes; got ${total}`);
      await shot('count');

      await press(page, device, '.surface-toggle >> text=Wall');
      const wallAfter = (await expectState(page, (s) => s.doc.active === 'wall', 'back to the wall', (s) => s.doc.active)).doc.wall;
      assert(JSON.stringify(wallAfter) === JSON.stringify(wallBefore), 'the wall design is kept while working on the floor');
    },
  },

  // ---- Share: without the Web Share API the picture downloads
  {
    name: 'share-download',
    path: './?debug=1',
    init: () => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
    },
    async run(page, { device, saveDownload }) {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), press(page, device, 'button[aria-label="Share"]')]);
      assert(/^kt-wall-demo-ivory-bloom-2400x2700\.png$/.test(download.suggestedFilename()), `file name, got ${download.suggestedFilename()}`);
      const saved = await saveDownload(download, 'picture');
      assert(saved.isPng && saved.size > 20000, `a real PNG, got ${saved.size} bytes`);
      await page.locator('.toast:has-text("downloads")').waitFor({ state: 'visible', timeout: 3000 });
    },
  },

  // ---- Share: with the Web Share API (as on Android) the PNG file goes to the share sheet
  {
    name: 'share-api',
    path: './?debug=1',
    init: () => {
      Object.defineProperty(Navigator.prototype, 'canShare', { value: (data) => Array.isArray(data?.files) && data.files.length > 0, configurable: true });
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (data) => {
          const file = data.files[0];
          window.__shared = { name: file.name, type: file.type, size: file.size, title: data.title, text: data.text };
        },
        configurable: true,
      });
    },
    async run(page, { device }) {
      await press(page, device, 'button[aria-label="Share"]');
      await page.waitForFunction(() => window.__shared, null, { timeout: 15000 });
      const shared = await page.evaluate(() => window.__shared);
      assert(shared.type === 'image/png' && shared.size > 20000, `shares a PNG file, got ${JSON.stringify(shared)}`);
      assert(shared.title === 'Demo Ivory Bloom · Wall 2400 × 2700 mm', `title, got ${shared.title}`);
      // Opening wall, between motifs: 8 columns and no cuts, so Light 24 → 26 tiles, Dark/HL-A/HL-B 8 → 9 each.
      assert(shared.text.includes('53 tiles, 10 boxes'), `text has the totals, got ${shared.text}`);
    },
  },

  // ---- Autosave: the design survives a reload; damaged saved data starts fresh
  {
    name: 'autosave',
    path: './?debug=1',
    async run(page, { device }) {
      const bandCount = (s) => s.doc.wall.layout.bands.length;
      await press(page, device, '.sheet-tab:has-text("Design")');
      await press(page, device, '.preset-choice:has-text("Classic")');
      await expectState(page, (s) => bandCount(s) === 2, 'Classic applied', (s) => s.doc.wall.layout.bands);
      await pause(700);
      await page.reload();
      await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      await expectState(page, (s) => bandCount(s) === 2, 'the design is restored after a reload', (s) => s.doc.wall.layout.bands);
      await page.evaluate(() => localStorage.setItem('kt-tile-designer:design:v1', '{"version":1,"active":"wall","wall":{"broken":true}}'));
      await page.reload();
      await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      await expectState(page, (s) => bandCount(s) === 4, 'damaged saved data starts fresh', (s) => s.doc.wall.layout.bands);
    },
  },

  // ---- Photo mode: the switch, every sample photo, EXIF orientation from the gallery
  {
    name: 'photo-switch',
    path: './?debug=1',
    async run(page, { device, shot }) {
      await press(page, device, '.view-toggle button[aria-label="Photo"]');
      await expectState(page, (s) => s.ui.view === 'photo' && s.ui.tab === 'photo', 'photo mode open on the Photo tab', (s) => s.ui);
      await page.locator('.photo-empty').waitFor({ state: 'visible', timeout: 3000 });
      assert(await page.locator('.photo-empty button:has-text("Take photo")').isVisible(), 'Take photo offered');
      assert(await page.locator('.photo-empty button:has-text("Choose from gallery")').isVisible(), 'gallery offered');
      await shot('empty');
      await press(page, device, '.view-toggle button[aria-label="Designer"]');
      await expectState(page, (s) => s.ui.view === 'designer' && s.ui.tab !== 'photo', 'back in the designer', (s) => s.ui);
    },
  },
  {
    name: 'photo-samples',
    path: './?debug=1&view=photo',
    async run(page, { device, shot }) {
      // Every photo in public/samples: the first from the empty state, the rest from the Photo tab.
      const titles = await page.locator('.photo-empty .sample-button').allTextContents();
      assert(titles.length > 0, 'at least one sample photo in public/samples');
      for (const [i, title] of titles.entries()) {
        if (i === 0) {
          await press(page, device, `.photo-empty .sample-button:text-is("${title}")`);
        } else {
          if (!(await page.locator('.tab-photo').isVisible())) await press(page, device, '.sheet-tab:text-is("Photo")');
          await press(page, device, `.tab-photo .sample-button:text-is("${title}")`);
        }
        await page.waitForFunction((t) => window.ktDebug.photo()?.name === t, title, { timeout: 15000 });
        const photo = await page.evaluate(() => window.ktDebug.photo());
        assert(Math.max(photo.width, photo.height) <= 2048, `${title}: at most 2048 px, got ${photo.width}x${photo.height}`);
        await pause(150);
        await shot(`sample-${i + 1}`);
      }
    },
  },
  {
    name: 'photo-zoom',
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device }) {
      await page.waitForFunction(() => window.ktDebug.photo()?.view, null, { timeout: 15000 });
      // Let the wall finder finish first: its result arriving mid-gesture delays the synthetic
      // second tap past the double-tap window (real touches carry their own timestamps).
      await segmented(page, 'Old bathroom with subway tiles');
      const view = () => page.evaluate(() => window.ktDebug.photo().view);
      const fit = await view();
      // On the bathtub: a tap there adds no surface, so the double-tap only fits the photo.
      const centre = await photoScreen(page, 700, 1250);
      if (device === 'desktop') {
        await page.mouse.move(centre.x, centre.y);
        await page.mouse.wheel(0, -600);
      } else {
        const input = await pointer(page, device);
        await input.pinch(centre, 80, 2.5);
      }
      await pause(120);
      const zoomed = await view();
      assert(zoomed.scale > fit.scale * 1.5, `zoomed in on the photo (${fit.scale.toFixed(3)} → ${zoomed.scale.toFixed(3)})`);
      // The point under the fingers stays put while zooming.
      const moved = await photoScreen(page, 700, 1250);
      assert(Math.hypot(moved.x - centre.x, moved.y - centre.y) < 20, `zoom keeps the photo point under the pointer (moved ${(moved.x - centre.x).toFixed(0)}, ${(moved.y - centre.y).toFixed(0)} px)`);
      const input = await pointer(page, device);
      await input.tap(centre);
      await pause(60);
      await input.tap(centre);
      await pause(150);
      const back = await view();
      assert(Math.abs(back.scale - fit.scale) < 1e-6 && Math.abs(back.x - fit.x) < 0.5, `double-tap fits the photo again (${back.scale.toFixed(3)} vs ${fit.scale.toFixed(3)})`);
    },
  },
  {
    name: 'photo-exif',
    path: './?debug=1&view=photo',
    async run(page, { device }) {
      // A 300 × 150 JPEG tagged "rotate 90° clockwise" (EXIF orientation 6) must open as 150 × 300.
      const jpegBase64 = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 300;
        c.height = 150;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#c33';
        ctx.fillRect(0, 0, 150, 150);
        ctx.fillStyle = '#33c';
        ctx.fillRect(150, 0, 150, 150);
        return c.toDataURL('image/jpeg', 0.9).split(',')[1];
      });
      const jpeg = Buffer.from(jpegBase64, 'base64');
      const exif = Buffer.from([
        0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
        0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, device, '.photo-empty button:has-text("Choose from gallery")')]);
      await chooser.setFiles({ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: rotated });
      await page.waitForFunction(() => window.ktDebug.photo()?.name === 'rotated.jpg', null, { timeout: 15000 });
      const photo = await page.evaluate(() => window.ktDebug.photo());
      assert(photo.width === 150 && photo.height === 300, `EXIF orientation applied: expected 150x300, got ${photo.width}x${photo.height}`);
    },
  },

  // ---- Finding walls and floor: the real model on every sample photo, then tapping a wall
  {
    name: 'photo-segment',
    path: './?debug=1&view=photo',
    async run(page, { device, shot }) {
      const titles = await page.locator('.photo-empty .sample-button').allTextContents();
      for (const [i, title] of titles.entries()) {
        if (i === 0) {
          await press(page, device, `.photo-empty .sample-button:text-is("${title}")`);
        } else {
          if (!(await page.locator('.tab-photo').isVisible())) await press(page, device, '.sheet-tab:text-is("Photo")');
          await press(page, device, `.tab-photo .sample-button:text-is("${title}")`);
        }
        const seg = await segmented(page, title);
        console.log(`    ${title}: ${seg.model}; load ${seg.timings.load} ms, run ${seg.timings.run} ms, edges ${seg.timings.refine} ms (headless desktop Chrome, not a phone)`);
        console.log(`    found wall ${pct(seg.shares.wall)}, floor ${pct(seg.shares.floor)}, ceiling ${pct(seg.shares.ceiling)}`);
        assert(seg.shares.wall > 0.05, `${title}: some wall found`);
        await pause(150);
        await shot(`regions-${i + 1}`);
        const point = await page.evaluate(() => window.ktDebug.labelPoint(1));
        assert(point, 'a wall region to tap');
        const input = await pointer(page, device);
        await input.tap(await photoScreen(page, point.x, point.y));
        await page.waitForFunction(() => window.ktDebug.surfaces().some((s) => s.kind === 'wall'), null, { timeout: 3000 });
        const [wall] = await surfacesOf(page);
        console.log(`    tapped wall: ${wall.starter ? 'starter rectangle (the region is not one quadrilateral)' : 'corners fitted to the region'}`);
        assert(wall.quad?.length === 4, 'the tapped wall has four corners');
        await pause(150);
        await shot(`wall-${i + 1}`);
        // The tiled result, then before / after.
        await press(page, device, '.fit-card button:text-is("Done")');
        await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
        await pause(150);
        await shot(`tiled-${i + 1}`);
        await press(page, device, '.photo-tools button:has-text("Before / after")');
        await page.locator('.compare').waitFor({ state: 'visible', timeout: 2000 });
        await pause(150);
        await shot(`before-after-${i + 1}`);
        await press(page, device, '.photo-tools button:has-text("Before / after")');
      }
    },
  },
  {
    // ?backend=wasm: the WASM path, which is also the fallback where WebGPU isn't available.
    name: 'photo-wasm',
    devices: ['desktop'],
    path: './?debug=1&view=photo&backend=wasm&sample=old-bathroom-subway-tiles.jpg',
    async run(page) {
      const seg = await segmented(page, 'Old bathroom with subway tiles');
      console.log(`    ${seg.model}; load ${seg.timings.load} ms, run ${seg.timings.run} ms, edges ${seg.timings.refine} ms (headless desktop Chrome)`);
      console.log(`    found wall ${pct(seg.shares.wall)}, floor ${pct(seg.shares.floor)}`);
      assert(/WASM/.test(seg.model), `ran on WASM (${seg.model})`);
      assert(Math.abs(seg.shares.wall - 0.64) < 0.03, 'about the same wall as on WebGPU');
    },
  },
  {
    // Addition 3: do the edges follow the basin and WC? The same views with and without the guided filter.
    name: 'photo-edges',
    devices: ['desktop'],
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { shot }) {
      const base = page.url();
      for (const edges of ['guided', 'bilinear']) {
        if (edges === 'bilinear') {
          await page.goto(`${base}&edges=bilinear`);
          await page.waitForSelector('body[data-ready="true"]');
        }
        await segmented(page, 'Old bathroom with subway tiles');
        for (const [name, x, y] of [
          ['basin', 1580, 930],
          ['wc', 1880, 1250],
        ]) {
          await page.evaluate(([px, py]) => window.ktDebug.photoZoom(px, py, 3), [x, y]);
          await pause(200);
          await shot(`${name}-${edges}`);
        }
      }
    },
  },

  // ---- Picking surfaces in the photo: corners with a loupe, the real size, a wall and a floor with different series
  {
    name: 'photo-fit',
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      const before = await state(page);
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      const [wall] = await surfacesOf(page);
      assert(wall.kind === 'wall' && wall.active && !wall.confirmed, 'a wall to fit, being edited');
      assert(wall.series === before.doc.wall.layout.seriesId, "it starts with the designer's wall series");
      assert(wall.size.w === before.doc.wall.surface.widthMm && wall.size.h === before.doc.wall.surface.heightMm, "its size is pre-filled from the designer's wall");
      // This sample's wall region wraps two walls, so its corners start as a rectangle around the tap.
      assert(wall.starter, 'a starter rectangle for a region covering two walls');
      assert((await page.locator('.photo-hint').textContent()) === "Drag the corners to this wall's edges", 'the hint for a starter rectangle');
      assert(await page.locator('.fit-card').isVisible(), 'the fit card is showing');
      await shot('fitting');

      // Drag the top-right corner; the loupe shows while dragging, and the drag is one undo step.
      const input = await pointer(page, device);
      const scale = (await page.evaluate(() => window.ktDebug.photo().view)).scale;
      const from = await photoScreen(page, wall.quad[2].x, wall.quad[2].y);
      await input.down(from);
      await input.move({ x: from.x + 20, y: from.y + 15 }, 4);
      await input.move({ x: from.x + 40, y: from.y + 30 }, 4);
      await pause(100);
      await shot('loupe');
      await input.up();
      await pause(60);
      let [moved] = await surfacesOf(page);
      const dx = moved.quad[2].x - wall.quad[2].x;
      const dy = moved.quad[2].y - wall.quad[2].y;
      assert(Math.abs(dx - 40 / scale) < 3 && Math.abs(dy - 30 / scale) < 3, `the corner follows the pointer (moved ${dx.toFixed(1)}, ${dy.toFixed(1)} photo px)`);
      await press(page, device, 'button[aria-label="Undo"]');
      [moved] = await surfacesOf(page);
      assert(moved.quad[2].x === wall.quad[2].x && moved.quad[2].y === wall.quad[2].y, 'undo puts the corner back');
      await press(page, device, 'button[aria-label="Redo"]');
      [moved] = await surfacesOf(page);
      assert(Math.abs(moved.quad[2].x - wall.quad[2].x - dx) < 1e-6, 'redo moves it again');

      // Confirm the real width, then Done: the tile grid appears in perspective.
      const width = page.locator('.fit-card input[aria-label="Real width"]');
      await width.fill('2450');
      await width.press('Enter');
      await expectState(page, (st) => st.doc.photo[0]?.plan.surface.widthMm === 2450, 'the width is confirmed', (st) => st.doc.photo[0]?.plan.surface);
      assert((await state(page)).doc.wall.surface.widthMm === before.doc.wall.surface.widthMm, "the designer's wall keeps its size");
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      assert(!(await page.locator('.fit-card').isVisible()), 'the fit card closes');
      await pause(150);
      await shot('wall-tiled');

      // The floor: a second surface, with the floor's design.
      await tapLabel(page, device, 2);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 2, null, { timeout: 3000 });
      const floor = (await surfacesOf(page))[1];
      assert(floor.kind === 'floor' && floor.active && floor.series === before.doc.floor.layout.seriesId, 'the floor is added with the floor series');
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[1]?.confirmed, null, { timeout: 2000 });

      // Editing the floor, the Design tab offers floor series only.
      await openTab(page, device, 'Design');
      assert((await page.locator('.photo-context').textContent()).includes('Floor'), 'the tab says the floor is being edited');
      const floorSeries = await page.locator('.tab-design .series-name').allTextContents();
      assert(floorSeries.length > 0 && floorSeries.every((name) => /floor/i.test(name)), `floor series only (${floorSeries.join(', ')})`);

      // Back to the wall (tap it), and give it another series: the floor and the designer keep theirs.
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.active, null, { timeout: 2000 });
      await openTab(page, device, 'Design');
      // The panel follows on the next frame.
      await page.locator('.tab-design .photo-context:has-text("Wall")').waitFor({ timeout: 2000 });
      const wallSeries = await page.locator('.tab-design .series-name').allTextContents();
      assert(wallSeries.length > 1 && !wallSeries.some((name) => /floor/i.test(name)), `wall series only (${wallSeries.join(', ')})`);
      await press(page, device, '.tab-design .series-choice:has-text("Demo Azure Medallion")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.series === 'demo-azure-medallion', null, { timeout: 2000 });
      const after = await state(page);
      assert(after.doc.photo[1].plan.layout.seriesId === before.doc.floor.layout.seriesId, 'the floor keeps its series');
      assert(after.doc.wall.layout.seriesId === before.doc.wall.layout.seriesId, "the designer's wall keeps its series");
      await pause(150);
      await shot('wall-and-floor');

      // The designer shows the photo wall flat, and says so; Wall goes back to the designer's own wall.
      await press(page, device, '.view-toggle button[aria-label="Designer"]');
      await page.waitForFunction(() => /^Photo wall: 2450/.test(document.querySelector('.size-chip')?.textContent ?? ''), null, { timeout: 2000 });
      await pause(150);
      await shot('designer');
      await press(page, device, '.surface-toggle button:has-text("Wall")');
      await expectState(page, (st) => st.doc.active === 'wall', "the designer's own wall", (st) => st.doc.active);
      assert(!(await page.locator('.size-chip').textContent()).startsWith('Photo'), 'the size chip shows the designer wall');
    },
  },
  {
    // Tiles on the photo with WebGL: in perspective, kept off fixtures, with the room's lighting.
    name: 'photo-tiles',
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      assert(await page.evaluate(() => window.ktDebug.webgl()), 'WebGL2 draws the tiles');
      const [wall] = await surfacesOf(page);
      // Points inside the wall's corners: on its region (label 1) and on fixtures (label 0), well away from edges.
      const points = await pointsInQuad(page, wall.quad);
      assert(points.wall.length > 20 && points.other.length > 0, `wall and fixture points inside the corners (${points.wall.length}, ${points.other.length})`);
      const pixels = (list) => page.evaluate((ps) => ps.map((p) => window.ktDebug.tilePixel(p.x, p.y)), list);
      const onWall = await pixels(points.wall);
      const onFixtures = await pixels(points.other);
      assert(onWall.every((px) => px[3] > 200), 'the tiles cover the wall');
      assert((await surfacesOf(page))[0].coverInfo.cover === 'found', 'on a wall the finder found, automatic keeps fixtures in front');
      assert(onFixtures.every((px) => px[3] < 30), `fixtures stay in front of the tiles (alpha ${Math.max(...onFixtures.map((px) => px[3]))})`);
      await pause(150);
      await shot('wall');

      // The Room lighting slider: at 0 the tiles are flat; at 100 they keep the photo's light and shadow.
      await openTab(page, device, 'Photo');
      const slider = page.locator('input[aria-label="Room lighting"]');
      const brightness = (list) => list.map((px) => (px[0] + px[1] + px[2]) / 3);
      await slider.fill('0');
      const flat = brightness(await pixels(points.wall));
      await slider.fill('100');
      const lit = brightness(await pixels(points.wall));
      const changed = flat.map((v, i) => Math.abs(lit[i] - v));
      const spread = (values) => Math.max(...values) - Math.min(...values);
      console.log(`    room lighting: brightness changes by up to ${Math.round(Math.max(...changed))}; spread across the wall ${Math.round(spread(flat))} at 0% → ${Math.round(spread(lit))} at 100%`);
      assert(Math.max(...changed) > 10, 'the slider changes the tiles');
      await slider.fill('70');

      // The floor too, in its own series.
      await tapLabel(page, device, 2);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 2, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[1]?.confirmed, null, { timeout: 2000 });
      const floorPoint = await page.evaluate(() => window.ktDebug.labelPoint(2));
      const [floorPixel] = await pixels([floorPoint]);
      assert(floorPixel[3] > 200, 'the floor is tiled');
      await pause(150);
      await shot('wall-and-floor');
      if (device === 'desktop') {
        await slider.fill('0');
        await pause(100);
        await shot('lighting-0');
        await slider.fill('100');
        await pause(100);
        await shot('lighting-100');
        await page.evaluate(() => window.ktDebug.photoZoom(700, 600, 3));
        await pause(150);
        await shot('grout-close-up');
        // Where the tiles meet the bathtub's rim: a soft edge, no stair steps.
        await page.evaluate(() => window.ktDebug.photoZoom(720, 1000, 4));
        await pause(150);
        await shot('rim-close-up');
      }
    },
  },
  {
    // Editing on the photo: the pattern drags with the designer's snapping; the brush fixes the mask.
    name: 'photo-edit',
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      assert(await page.locator('.photo-tools').isVisible(), 'the tools show for a tiled surface');
      let [wall] = await surfacesOf(page);
      assert(wall.alignment.x.mode === 'centre-between-motifs', "the wall starts with the designer's alignment");

      // 150 mm to the right along the wall, as in the designer's own check: it snaps to a centred motif.
      const { w, h } = wall.size;
      const mm = (x, y) => page.evaluate(([px, py]) => window.ktDebug.surfacePoint('photo-1', px, py), [x, y]);
      const fromPhoto = await mm(w / 2, h / 2);
      const toPhoto = await mm(w / 2 + 150, h / 2);
      // At fit size on a phone 150 mm is under the 8 px touch slop: zoom in, as a user would for a fine move.
      await page.evaluate(([x, y]) => window.ktDebug.photoZoom(x, y, 2.5), [fromPhoto.x, fromPhoto.y]);
      await pause(100);
      const from = await photoScreen(page, fromPhoto.x, fromPhoto.y);
      const to = await photoScreen(page, toPhoto.x, toPhoto.y);
      const input = await pointer(page, device);
      await input.down(from);
      await input.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 4);
      await pause(100);
      await shot('mid-drag');
      await input.move(to, 4);
      await input.up();
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.alignment.x.mode === 'centre-motif', null, { timeout: 2000 });
      assert((await state(page)).doc.wall.alignment.x.mode === 'centre-between-motifs', "the designer's wall stays put");
      await press(page, device, 'button[aria-label="Undo"]');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.alignment.x.mode === 'centre-between-motifs', null, { timeout: 2000 });

      // Back to the whole photo for the brush.
      await page.evaluate(() => {
        const { width, height } = window.ktDebug.photo();
        window.ktDebug.photoZoom(width / 2, height / 2, 1);
      });
      await pause(100);

      // Remove: painting over the wall hides the tiles there; undo brings them back.
      [wall] = await surfacesOf(page);
      const points = await pointsInQuad(page, wall.quad);
      const target = points.wall[Math.floor(points.wall.length / 2)];
      assert(target && (await alphaAt(page, target)) > 200, 'tiles on the wall before brushing');
      await press(page, device, '.photo-tools button:has-text("Remove")');
      const at = await photoScreen(page, target.x, target.y);
      await input.down({ x: at.x - 12, y: at.y });
      await input.move({ x: at.x + 12, y: at.y }, 4);
      await input.up();
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.strokes === 1, null, { timeout: 2000 });
      assert((await alphaAt(page, target)) < 30, 'brushed away');
      await pause(100);
      await shot('removed');
      await press(page, device, 'button[aria-label="Undo"]');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.strokes === 0, null, { timeout: 2000 });
      assert((await alphaAt(page, target)) > 200, 'undo brings the tiles back');

      // Add: a tap with the Add brush on a fixture inside the wall tiles it.
      const fixture = points.other[0];
      assert(fixture && (await alphaAt(page, fixture)) < 30, 'a fixture inside the wall, in front of the tiles');
      await press(page, device, '.photo-tools button:has-text("Add")');
      const spot = await photoScreen(page, fixture.x, fixture.y);
      await (await pointer(page, device)).tap(spot);
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.strokes === 1, null, { timeout: 2000 });
      assert((await alphaAt(page, fixture)) > 200, 'tiles added over the fixture');
      await press(page, device, '.photo-tools button:has-text("Pattern")');

      // The perspective grid and centreline, on request.
      await openTab(page, device, 'Photo');
      await press(page, device, '.tab-photo button:has-text("Show grid and centreline")');
      assert(await page.locator('.tab-photo button:has-text("Clear brush changes")').isVisible(), 'brush changes can be cleared');
      await pause(150);
      await shot('grid');
    },
  },
  {
    // Corners on a wall the wall finder missed (it took it for something else): the tiles fill the
    // corners rather than the finder's sliver, and the Photo tab can switch between the two.
    // The fake segmenter's plain room makes this repeatable: the corners go onto its "floor".
    name: 'photo-cover',
    path: './?debug=1&view=photo&segmenter=fake&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      const input = await pointer(page, device);
      // Bottom corners first, then the top ones, so the corners never cross.
      const targets = [
        [0, { x: 300, y: 1480 }],
        [1, { x: 1700, y: 1480 }],
        [3, { x: 300, y: 1260 }],
        [2, { x: 1700, y: 1260 }],
      ];
      for (const [corner, target] of targets) {
        const quad = (await surfacesOf(page))[0].quad;
        const from = await photoScreen(page, quad[corner].x, quad[corner].y);
        const to = await photoScreen(page, target.x, target.y);
        await input.down(from);
        await input.move(to, 6);
        await input.up();
        await pause(60);
      }
      const [moved] = await surfacesOf(page);
      assert(moved.quad.every((q, i) => Math.hypot(q.x - targets.find(([c]) => c === i)[1].x, q.y - targets.find(([c]) => c === i)[1].y) < 6), `the corners moved: ${JSON.stringify(moved.quad)}`);
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      await page.locator('.toast:has-text("so the tiles fill your corners")').waitFor({ state: 'visible', timeout: 3000 });
      const [wall] = await surfacesOf(page);
      assert(wall.tileCover === 'auto' && wall.coverInfo.cover === 'corners' && wall.coverInfo.found < 0.05, `automatic fill: ${JSON.stringify(wall.coverInfo)}`);
      const inside = { x: 1000, y: 1370 };
      assert((await alphaAt(page, inside)) > 200, 'tiles fill the corners');
      await pause(150);
      await shot('fills-corners');

      // "Where the wall is" goes back to the wall finder's area (none of it here); Automatic fills again.
      await openTab(page, device, 'Photo');
      await press(page, device, '.cover-choice button:has-text("Where the wall is")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.tileCover === 'found', null, { timeout: 2000 });
      assert((await alphaAt(page, inside)) < 30, 'only where the wall finder found the wall');
      await press(page, device, '.cover-choice button:has-text("Automatic")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.tileCover === 'auto', null, { timeout: 2000 });
      assert((await alphaAt(page, inside)) > 200, 'automatic fills the corners again');
      assert((await page.locator('.tab-photo .tab-hint:has-text("found only")').count()) === 1, 'the tab explains the automatic choice');
    },
  },
  {
    // A wall running past every edge of the photo, seen at 35°: its outline gives no corners, so
    // they mark a rectangle along its lines (stripes every 300 mm, joints every 600 mm), and keep
    // to them when dragged. The photo is drawn here, so where its lines meet is known exactly.
    name: 'photo-lines',
    path: './?debug=1&view=photo&segmenter=fake-wall',
    async run(page, { device, shot }) {
      const W = 1200;
      const H = 900;
      const f = 0.72 * W;
      const turn = (35 * Math.PI) / 180;
      const png = await page.evaluate(
        ([W, H, f, turn]) => {
          // Camera space: x right, y down, z ahead; the wall's horizontal runs off to the right.
          const along = [Math.cos(turn), 0, Math.sin(turn)];
          const origin = [-900, 900, 1500];
          const project = (u, v) => {
            const p = [origin[0] + u * along[0], origin[1] - v, origin[2] + u * along[2]];
            return [(f * p[0]) / p[2] + W / 2, (f * p[1]) / p[2] + H / 2];
          };
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d');
          g.fillStyle = '#e9e3d7';
          g.fillRect(0, 0, W, H);
          const quad = (u0, v0, u1, v1, colour) => {
            g.fillStyle = colour;
            g.beginPath();
            [project(u0, v0), project(u1, v0), project(u1, v1), project(u0, v1)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.closePath();
            g.fill();
          };
          const [u0, u1, v0, v1] = [-2200, 9000, -3000, 5000];
          for (let v = v0; v < v1; v += 300) quad(u0, v, u1, v + 40, '#b9ab90');
          for (let u = 0; u < u1; u += 600) quad(u, v0, u + 8, v1, '#8d8a84');
          return c.toDataURL('image/png').split(',')[1];
        },
        [W, H, f, turn],
      );
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, device, '.photo-empty button:has-text("Choose from gallery")')]);
      await chooser.setFiles({ name: 'striped-wall.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await segmented(page, 'striped-wall.png');
      const photo = await page.evaluate(() => window.ktDebug.photo());
      const k = photo.width / W;
      // Where the wall's horizontals meet: straight ahead along the wall, at the camera's height.
      const expected = { x: ((f * Math.cos(turn)) / Math.sin(turn) + W / 2) * k, y: (H / 2) * k };
      const input = await pointer(page, device);
      await input.tap(await photoScreen(page, photo.width * 0.45, photo.height * 0.5));
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 5000 });

      const meet = (a, b, c, d) => {
        const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
        const s = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
        return { x: a.x + s * (b.x - a.x), y: a.y + s * (b.y - a.y) };
      };
      const followsLines = (quad, label) => {
        const h = meet(quad[0], quad[1], quad[3], quad[2]);
        const off = Math.hypot(h.x - expected.x, h.y - expected.y) / Math.hypot(expected.x - photo.width / 2, expected.y - photo.height / 2);
        assert(off < 0.05, `${label}: top and bottom meet where the wall's horizontals do (${Math.round(h.x)}, ${Math.round(h.y)} vs ${Math.round(expected.x)}, ${Math.round(expected.y)})`);
        const lean = (p, q) => Math.abs(p.x - q.x) / Math.abs(p.y - q.y);
        assert(lean(quad[0], quad[3]) < 0.02 && lean(quad[1], quad[2]) < 0.02, `${label}: the sides stay upright like the wall's verticals`);
      };
      const [lined] = await surfacesOf(page);
      assert(lined.marks === 'rectangle' && lined.vanishing, `a wall running off the photo marks a rectangle along its lines (${lined.marks})`);
      followsLines(lined.quad, 'the rectangle');
      assert((await page.locator('.fit-card .fit-note:has-text("runs past the photo")').count()) === 1, 'the card says why');
      assert((await page.locator('.photo-hint:has-text("something you know the size of")').count()) === 1, 'the hint says what to do');
      await pause(150);
      await shot('rectangle');

      // Drag the top-right corner: the rectangle stays along the lines; the bottom-left stays put.
      const from = await photoScreen(page, lined.quad[2].x, lined.quad[2].y);
      await input.down(from);
      await input.move({ x: from.x + 30, y: from.y - 25 }, 6);
      await input.up();
      await pause(60);
      const [dragged] = await surfacesOf(page);
      assert(Math.hypot(dragged.quad[2].x - lined.quad[2].x, dragged.quad[2].y - lined.quad[2].y) > 10, 'the corner moved');
      assert(Math.hypot(dragged.quad[0].x - lined.quad[0].x, dragged.quad[0].y - lined.quad[0].y) < 0.5, 'the opposite corner stayed');
      followsLines(dragged.quad, 'after a drag');

      // Its size, then Done: the tiles cover the whole photo, which is all wall.
      const width = page.locator('.fit-card input[aria-label="Rectangle width"]');
      await width.fill('600');
      await width.press('Enter');
      const height = page.locator('.fit-card input[aria-label="Rectangle height"]');
      await height.fill('900');
      await height.press('Enter');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.rect.w === 600 && window.ktDebug.surfaces()[0]?.rect.h === 900, null, { timeout: 2000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 3000 });
      const corners = [0.05, 0.95].flatMap((u) => [0.05, 0.95].map((v) => ({ x: photo.width * u, y: photo.height * v })));
      for (const p of corners) assert((await alphaAt(page, p)) > 200, `tiles at (${Math.round(p.x)}, ${Math.round(p.y)})`);
      // Nothing off the photo, though the surface's outline runs well past it.
      const off = [
        { x: photo.width * 1.03, y: photo.height / 2 },
        { x: -photo.width * 0.03, y: photo.height / 2 },
        { x: photo.width / 2, y: photo.height * 1.03 },
        { x: photo.width / 2, y: -photo.height * 0.03 },
      ];
      for (const p of off) assert((await alphaAt(page, p)) < 30, `no tiles off the photo at (${Math.round(p.x)}, ${Math.round(p.y)})`);
      await pause(150);
      await shot('tiles');
    },
  },
  {
    // Before / after: the tiles only to the right of the line, which drags.
    name: 'photo-compare',
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await tileTheWall(page, device);
      await press(page, device, '.photo-tools button:has-text("Before / after")');
      await page.locator('.compare').waitFor({ state: 'visible', timeout: 2000 });
      assert(!(await page.locator('.photo-tools .tool-switch').isVisible()), 'the tools step aside while comparing');
      // Drag the line to 30% of the stage.
      const stage = await page.locator('.photo-stage').boundingBox();
      const handle = await page.locator('.compare-handle').boundingBox();
      const input = await pointer(page, device);
      const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await input.down(from);
      await input.move({ x: stage.x + stage.width * 0.3, y: from.y }, 6);
      await input.up();
      await pause(100);
      const clip = await page.evaluate(() => document.querySelector('.photo-tiles').style.clipPath);
      assert(/^inset\(0(px)? 0(px)? 0(px)? 3\d(\.\d+)?%\)$/.test(clip), `the tiles show right of the line only (clip ${clip})`);
      assert((await page.locator('.compare-handle').getAttribute('aria-valuenow')) === '30', 'the handle reports where it is');
      await shot('dragged');
      await press(page, device, '.photo-tools button:has-text("Before / after")');
      await page.locator('.compare').waitFor({ state: 'hidden', timeout: 2000 });
      assert((await page.evaluate(() => document.querySelector('.photo-tiles').style.clipPath)) === '', 'all the tiles again');
    },
  },
  {
    // Share in photo mode, where files can't be shared: the photo with its tiles downloads.
    name: 'photo-share',
    devices: ['desktop'],
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    init: () => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
    },
    async run(page, { device, saveDownload }) {
      await tileTheWall(page, device);
      assert(await asksBeforeLeaving(page), 'unshared photo work asks before leaving');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), press(page, device, 'button[aria-label="Share"]')]);
      assert(/^kt-photo-wall-\d{4}-\d{2}-\d{2}\.png$/.test(download.suggestedFilename()), `file name, got ${download.suggestedFilename()}`);
      const saved = await saveDownload(download, 'picture');
      const { readFile } = await import('node:fs/promises');
      const size = pngSize(await readFile(saved.file));
      assert(saved.isPng && size.width === 2048 && size.height > 1536, `the photo at its own size with the summary below it, got ${size.width} × ${size.height}`);
      await page.locator('.toast:has-text("downloads")').waitFor({ state: 'visible', timeout: 3000 });
      assert(!(await asksBeforeLeaving(page)), 'saved: leaving no longer asks');
    },
  },
  {
    // Share in photo mode with the Web Share API (as on Android): the picture goes to the share sheet.
    name: 'photo-share-api',
    devices: ['phone'],
    path: './?debug=1&view=photo&sample=old-bathroom-subway-tiles.jpg',
    init: () => {
      Object.defineProperty(Navigator.prototype, 'canShare', { value: (data) => Array.isArray(data?.files) && data.files.length > 0, configurable: true });
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (data) => {
          const file = data.files[0];
          window.__shared = { name: file.name, type: file.type, size: file.size, title: data.title, text: data.text };
        },
        configurable: true,
      });
    },
    async run(page, { device }) {
      await tileTheWall(page, device);
      await tapLabel(page, device, 2);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 2, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[1]?.confirmed, null, { timeout: 2000 });
      await press(page, device, 'button[aria-label="Share"]');
      await page.waitForFunction(() => window.__shared, null, { timeout: 15000 });
      const shared = await page.evaluate(() => window.__shared);
      assert(shared.type === 'image/png' && shared.size > 200000, `shares a PNG of the photo, got ${JSON.stringify(shared)}`);
      assert(shared.title === 'Tiles on the photo · Wall: Demo Ivory Bloom · Floor: Demo Floor', `title names both surfaces, got ${shared.title}`);
      assert(/^Tiles on the photo: \d+ tiles, \d+ boxes in all\.$/.test(shared.text), `text has the totals, got ${shared.text}`);
      assert(!(await asksBeforeLeaving(page)), 'shared: leaving no longer asks');
    },
  },
  {
    // The photo never leaves the device: a whole session sends no request with a body, only GETs
    // to the site itself, the model's files (Hugging Face) and the libraries (jsDelivr).
    name: 'photo-network',
    devices: ['desktop'],
    path: './?debug=1&view=photo',
    init: () => {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
    },
    async run(page, { device, requests }) {
      // A photo of our own from the gallery, so nothing about it is on any server.
      const jpeg = Buffer.from(
        await page.evaluate(async () => {
          const response = await fetch('samples/old-bathroom-subway-tiles.jpg');
          const bitmap = await createImageBitmap(await response.blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
          return [...new Uint8Array(await blob.arrayBuffer())];
        }),
      );
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, device, '.photo-empty button:has-text("Choose from gallery")')]);
      await chooser.setFiles({ name: 'my-bathroom.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await segmented(page, 'my-bathroom.jpg');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      await Promise.all([page.waitForEvent('download', { timeout: 15000 }), press(page, device, 'button[aria-label="Share"]')]);
      const site = new URL(page.url()).host;
      const allowed = new Set([site, 'huggingface.co', 'cdn.jsdelivr.net']);
      const sent = requests.filter((r) => /^https?:/.test(r.url));
      const hosts = {};
      for (const r of sent) hosts[new URL(r.url).host] = (hosts[new URL(r.url).host] ?? 0) + 1;
      console.log(`    requests: ${Object.entries(hosts).map(([host, n]) => `${host} × ${n}`).join(', ')}`);
      const bad = sent.filter((r) => r.method !== 'GET' || r.body || !allowed.has(new URL(r.url).host));
      assert(bad.length === 0, `only GETs without bodies to the site, the model and the libraries; also saw ${JSON.stringify(bad.slice(0, 3))}`);
      assert(Object.keys(hosts).some((h) => h === 'huggingface.co'), 'the model files came from Hugging Face');
    },
  },
  {
    // Without WebGL2 (forced here) a grid shows where the tiles go.
    name: 'photo-no-webgl',
    devices: ['desktop'],
    path: './?debug=1&view=photo&webgl=0&segmenter=fake&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      assert(!(await page.evaluate(() => window.ktDebug.webgl())), 'WebGL is off');
      await openTab(page, device, 'Photo');
      assert(await page.locator('.tab-photo :text("WebGL 2 is off")').isVisible(), 'the Photo tab says why there is a grid');
      await pause(100);
      await shot('grid');
    },
  },
  {
    // The corners can mark any rectangle of known size; the surface is then measured from the photo.
    // The fake segmenter gives a plain room, so the wall's corners are fitted to its whole region.
    name: 'photo-rectangle',
    devices: ['desktop'],
    path: './?debug=1&view=photo&segmenter=fake&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device, shot }) {
      await segmented(page, 'Old bathroom with subway tiles');
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      const [wall] = await surfacesOf(page);
      assert(!wall.starter, 'a plain wall region gets fitted corners, not a starter');
      await press(page, device, '.fit-card button:text-is("A known rectangle")');
      assert(await page.locator('.fit-note').isVisible(), 'the rectangle mode explains itself');
      assert((await page.locator('.photo-hint').textContent()) === "Drag the corners to the rectangle's corners", 'the hint for a rectangle');
      // Say the fitted corners mark a 1200 × 1000 mm rectangle: the region is exactly that rectangle.
      for (const [label, value] of [
        ['Rectangle width', '1200'],
        ['Rectangle height', '1000'],
      ]) {
        const input = page.locator(`.fit-card input[aria-label="${label}"]`);
        await input.fill(value);
        await input.press('Enter');
      }
      await expectState(page, (st) => st.doc.photo[0]?.fit.rect.w === 1200 && st.doc.photo[0]?.fit.rect.h === 1000, 'the rectangle size is set', (st) => st.doc.photo[0]?.fit);
      await shot('rectangle');
      await press(page, device, '.fit-card button:text-is("Done")');
      await page.waitForFunction(() => window.ktDebug.surfaces()[0]?.confirmed, null, { timeout: 2000 });
      const [measured] = await surfacesOf(page);
      assert(measured.marks === 'rectangle', 'the corners mark a rectangle');
      assert(Math.abs(measured.size.w - 1200) <= 20 && Math.abs(measured.size.h - 1000) <= 20, `the wall is measured from the photo (${measured.size.w} × ${measured.size.h} mm)`);
      await pause(150);
      await shot('measured');
    },
  },
  {
    // Addition 4: photo work isn't saved, so leaving asks first, but only once there are photo surfaces.
    name: 'photo-leave',
    devices: ['desktop'],
    path: './?debug=1&view=photo&segmenter=fake&sample=old-bathroom-subway-tiles.jpg',
    async run(page, { device }) {
      await segmented(page, 'Old bathroom with subway tiles');
      const asks = () =>
        page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        });
      assert(!(await asks()), "no prompt while there's nothing to lose");
      await tapLabel(page, device, 1);
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 1, null, { timeout: 3000 });
      assert(await asks(), 'a prompt once there is a photo surface');
      // The real thing: closing the page shows the browser's "Leave site?" dialog.
      const dialog = page.waitForEvent('dialog', { timeout: 5000 });
      await page.close({ runBeforeUnload: true });
      const shown = await dialog;
      assert(shown.type() === 'beforeunload', `the browser's leave dialog (got ${shown.type()})`);
      await shown.dismiss();
      assert(!page.isClosed(), 'staying on the page keeps it open');
      await press(page, device, 'button[aria-label="Undo"]');
      await page.waitForFunction(() => window.ktDebug.surfaces().length === 0, null, { timeout: 2000 });
      assert(!(await asks()), 'no prompt once the surface is undone');
    },
  },

  // ---- Wall | Floor and the size editor
  {
    name: 'surface-and-size',
    path: './?debug=1',
    async run(page, { device, shot }) {
      await press(page, device, '.size-chip');
      await shot('size-editor');
      const width = page.locator('.size-form input').first();
      await width.fill('2450');
      await width.press('Enter');
      await width.blur();
      await expectState(page, (s) => s.doc.wall.surface.widthMm === 2450, 'width edited', (s) => s.doc.wall.surface);
      await press(page, device, '.surface-toggle >> text=Floor');
      await expectState(page, (s) => s.doc.active === 'floor', 'floor shown', (s) => s.doc.active);
      assert(await page.locator('.mode-switch button:has-text("Row")').isDisabled(), 'Row mode is off on floors');
      await shot('floor');
    },
  },

  // ---- AR test screen (step 3a). Real AR needs a phone; these cover the rest.
  {
    // Where AR can't run (here, headless Chrome on a laptop) the screen says why, and AR in the top bar gets there.
    name: 'ar-unsupported',
    path: './',
    async run(page, { device, shot }) {
      await press(page, device, '.view-toggle button[aria-label="AR"]');
      await page.waitForURL(/view=ar/, { timeout: 5000 });
      await page.waitForSelector('body[data-ready="true"]', { timeout: 5000 });
      const message = await page.locator('.ar-support').textContent();
      assert(/Android/.test(message ?? ''), `the screen says what AR needs: "${message}"`);
      assert(await page.locator('.ar-actions button:text-is("Start AR")').isDisabled(), 'Start AR is off');
      await shot('');
    },
  },
  {
    // With a stand-in for WebXR (a wall 2 m ahead and the floor): mark a wall by two corners, see
    // it tiled where marked and nowhere else, slide the pattern with a finger, switch series; then
    // mark a plain wall by its base; the designer opens with the measured wall.
    name: 'ar-fake',
    path: './?view=ar',
    init: fakeWebXr,
    async run(page, { device, shot }) {
      const statusHas = (text, timeout = 3000) => page.waitForFunction((t) => document.querySelector('.ar-overlay')?.textContent?.includes(t), text, { timeout });
      const frames = () => pause(120);
      const savedDesign = () => page.evaluate(() => JSON.parse(localStorage.getItem('kt-tile-designer:design:v1') ?? 'null'));
      const aimAt = async (point) => {
        await page.evaluate((p) => window.__fakeXr.aimAt(p), point);
        await frames();
      };
      const tap = async () => {
        await page.evaluate(() => window.__fakeXr.session.select());
        await frames();
      };

      await page.locator('.ar-support:text-is("This phone can run AR.")').waitFor({ timeout: 5000 });
      await press(page, device, '.ar-actions button:text-is("Start AR")');
      await statusHas('Aiming at: wall, 2.00 m away', 5000);
      const init = await page.evaluate(() => window.__fakeXr.init);
      assert(init.requiredFeatures.includes('hit-test') && init.optionalFeatures.includes('anchors') && init.domOverlay, `asks for hit test, anchors and the overlay: ${JSON.stringify(init.optionalFeatures)}`);
      await statusHas('Wall: aim the ring at one corner');

      // Aimed at the floor in Wall mode: says so, and marks nothing.
      await aimAt([0, 0, -1]);
      await tap();
      await statusHas("That's the floor, not a wall");

      // A wall 1.2 m wide and 1 m high, from (−0.6, 1.0) to (0.6, 2.0) on the wall.
      await aimAt([-0.6, 1.0, -2]);
      await tap();
      await statusHas('Now aim at the opposite corner');
      await aimAt([0.6, 2.0, -2]);
      await shot('marking');
      await tap();
      await statusHas('Wall 1.20 × 1.00 m · Demo Ivory Bloom');
      await statusHas('Drag on the tiles to slide the pattern.');
      const wall = (await savedDesign()).wall;
      assert(wall.surface.widthMm === 1200 && wall.surface.heightMm === 1000, `the measured size is saved for the designer: ${JSON.stringify(wall.surface)}`);

      // Tiles where the wall was marked, and nothing above it.
      await aimAt([0, 1.5, -2]);
      const { centre, top } = await page.evaluate(() => window.__fakeXr.pixels);
      assert(centre[3] === 255 && centre[0] + centre[1] + centre[2] > 150, `tiles in the marked area (${centre})`);
      assert(top[3] === 0, `nothing above it (${top})`);
      await shot('tiled');

      // A finger dragged 150 mm to the right slides the pattern.
      const before = wall.alignment;
      await page.evaluate(() => {
        window.__fakeXr.touchAt([0, 1.5, -2]);
        window.__fakeXr.session.selectstart();
      });
      await frames();
      await page.evaluate(() => window.__fakeXr.touchAt([0.15, 1.5, -2]));
      await frames();
      await page.evaluate(() => window.__fakeXr.session.selectend());
      await frames();
      const after = (await savedDesign()).wall.alignment;
      assert(JSON.stringify(after) !== JSON.stringify(before), `the drag moved the pattern: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await statusHas('Wall 1.20 × 1.00 m', 2000);

      // Another series, saved too.
      await press(page, device, '.ar-controls button:text-is("Series")');
      await statusHas('Wall 1.20 × 1.00 m · Demo Azure Medallion');
      assert((await savedDesign()).wall.layout.seriesId === 'demo-azure-medallion', 'the series is saved');

      // A plain wall by its base: two points where it meets the floor (just in front of the wall), then its top.
      await press(page, device, '.ar-controls button:text-is("Mark again")');
      await press(page, device, '.ar-modes button:text-is("Wall by its base")');
      await statusHas('Plain wall: aim where the wall meets the floor');
      await aimAt([-0.8, 0, -1.95]);
      await tap();
      await statusHas('Now where it meets the floor at the other end');
      await aimAt([0.8, 0, -1.95]);
      await tap();
      await statusHas('Now aim at the top of the wall');
      await aimAt([0, 2.2, -1.95]);
      await tap();
      await statusHas('Wall 1.60 × 2.20 m');

      // The designer opens on the measured wall, with the series chosen in AR.
      await press(page, device, '.ar-controls button:text-is("Exit AR")');
      await page.locator('.ar-report:has-text("Last session:")').waitFor({ timeout: 3000 });
      assert((await page.locator('.ar-report').textContent()).includes('Wall 1.60 × 2.20 m'), 'the report has the last surface');
      await shot('report');
      await page.goto(new URL('./?debug=1&tab=count', page.url()).href);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 10000 });
      const designer = await page.evaluate(() => window.ktDebug.state().doc);
      assert(designer.active === 'wall' && designer.wall.surface.widthMm === 1600 && designer.wall.surface.heightMm === 2200, `the designer has the measured wall: ${JSON.stringify(designer.wall.surface)}`);
      assert(designer.wall.layout.seriesId === 'demo-azure-medallion', 'and the series chosen in AR');
      await shot('designer');
    },
  },
];
