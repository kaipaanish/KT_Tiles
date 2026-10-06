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
      const view = () => page.evaluate(() => window.ktDebug.photo().view);
      const fit = await view();
      const centre = await photoScreen(page, 1024, 768);
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
      const moved = await photoScreen(page, 1024, 768);
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
        await page.waitForFunction(() => window.ktDebug.selection()?.label === 1, null, { timeout: 3000 });
        const selection = await page.evaluate(() => window.ktDebug.selection());
        console.log(`    tapped wall: ${pct(selection.share)} of the photo, ${selection.starter ? 'starter quad (two walls?)' : 'fitted quad'}, 1 − IoU ${pct(selection.mismatch)}`);
        assert(selection.quad?.length === 4, 'the tapped wall has four corners');
        await pause(150);
        await shot(`wall-${i + 1}`);
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
