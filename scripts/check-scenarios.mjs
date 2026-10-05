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
      assert(alignX(start).mode === 'centre-motif', 'opens centred on the motif');
      const scale = await viewScale(page);
      const from = await screenOf(page, 1200, 1100);
      const input = await pointer(page, device);
      await input.down(from);
      await input.move({ x: from.x + 75 * scale, y: from.y });
      await shot('mid-drag');
      await input.move({ x: from.x + 150 * scale, y: from.y });
      await input.up();
      await expectState(page, (s) => alignX(s).mode === 'centre-joint' && s.canUndo, '150 mm to the right snaps to centre-joint', alignX);
      await shot('after');
      await press(page, device, 'button[aria-label="Undo"]');
      await expectState(page, (s) => alignX(s).mode === 'centre-motif' && !s.canUndo, 'undo restores it, and the whole drag was one step', alignX);
      await press(page, device, 'button[aria-label="Redo"]');
      await expectState(page, (s) => alignX(s).mode === 'centre-joint', 'redo re-applies it', alignX);
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
];
