import { countTiles, formatMm } from '../../engine';
import * as act from '../../state/actions';
import { h } from '../dom';
import { tileThumb } from '../thumbs';
import type { TabContext } from './context';
import { numberInput, section } from './parts';

/** Pieces, tiles to buy and boxes for each tile, with totals and area. */
export function countTab(ctx: TabContext): HTMLElement {
  const { state, result, catalog, textures, store } = ctx;
  const allowance = state.doc.settings.allowancePct;
  const count = countTiles(result.pieces, allowance, catalog);

  const head = h('tr', {}, ...['Tile', 'Full', 'Cut', 'Pieces', 'Tiles', 'Boxes'].map((label) => h('th', { scope: 'col' }, label)));
  const body = h('tbody', {});
  for (const row of count.tiles) {
    body.append(
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, h('span', { class: 'count-tile' }, tileThumb(row.tileId, catalog, textures, 18, 26), h('span', {}, h('span', { class: 'count-name' }, row.name), h('span', { class: 'count-box' }, `box of ${row.tilesPerBox}`)))),
        h('td', {}, String(row.full)),
        h('td', {}, String(row.cut)),
        h('td', {}, String(row.pieces)),
        h('td', { class: 'strong' }, String(row.tilesNeeded)),
        h('td', { class: 'strong' }, String(row.boxes)),
      ),
    );
  }
  const t = count.totals;
  const foot = h(
    'tr',
    {},
    h('th', { scope: 'row' }, 'Total'),
    h('td', {}, String(t.full)),
    h('td', {}, String(t.cut)),
    h('td', {}, String(t.pieces)),
    h('td', { class: 'strong' }, String(t.tilesNeeded)),
    h('td', { class: 'strong' }, String(t.boxes)),
  );
  const table = h('table', { class: 'count-table' }, h('thead', {}, head), body, h('tfoot', {}, foot));

  const allowanceInput = numberInput(allowance, {
    min: 0,
    max: 50,
    step: 1,
    label: 'Allowance for breakage, in percent',
    onCommit: (pct) => store.commit((d) => act.setSettings(d, { allowancePct: pct })),
  });

  const surface = state.doc.active === 'wall' ? 'wall' : 'floor';
  return h(
    'div',
    { class: 'tab tab-count' },
    section(`Tiles for this ${surface}`, h('div', { class: 'table-scroll' }, table)),
    h(
      'div',
      { class: 'count-summary' },
      h('div', {}, h('span', { class: 'summary-label' }, 'Tiled area'), h('span', { class: 'summary-value' }, `${t.areaM2.toFixed(2)} m² · ${t.areaSqFt.toFixed(1)} sq ft`)),
      h(
        'label',
        { class: 'field' },
        h('span', {}, 'Allowance'),
        h('span', { class: 'field-input' }, allowanceInput, h('span', { class: 'unit' }, '%')),
      ),
    ),
    h(
      'p',
      { class: 'tab-hint' },
      `Counts are conservative: each cut piece uses one whole tile, because offcuts aren't reused. Tiles = pieces + ${formatMm(allowance)}% allowance, rounded up; boxes are rounded up per tile.`,
    ),
  );
}
