import type { Tile, TileRole } from '../../engine';
import * as act from '../../state/actions';
import { activePlan } from '../../state/document';
import { h, icon, ICONS } from '../dom';
import { bandRangeLabel } from '../labels';
import { tileThumb } from '../thumbs';
import type { TabContext } from './context';
import { section } from './parts';

const ROLE_ORDER: readonly TileRole[] = ['light', 'dark', 'highlighter', 'floor'];
const ROLE_TITLES: Record<TileRole, string> = { light: 'Light', dark: 'Dark', highlighter: 'Highlighter', floor: 'Floor tiles' };

/** The current series' tiles, grouped by role. Tapping one puts it in the selected band or tile. */
export function tilesTab(ctx: TabContext): HTMLElement {
  const { state, result, catalog, textures, store } = ctx;
  const { doc, ui } = state;
  const plan = activePlan(doc);
  const tileTarget = ui.mode === 'tile' && ui.selectedCell ? ui.selectedCell : null;
  const bandTarget = !tileTarget && doc.active === 'wall' && ui.selectedBand !== null ? result.bands[ui.selectedBand] : undefined;

  let hint: string;
  if (tileTarget) hint = 'Tap a tile to put it in the selected spot on the wall.';
  else if (bandTarget) hint = `Tap a tile to use it for the band ${bandRangeLabel(bandTarget, catalog)}.`;
  else if (doc.active === 'wall') hint = 'Select a band (Row mode) or a tile (Tile mode), then tap a tile here.';
  else hint = 'Select a tile in Tile mode, then tap a tile here to replace it.';

  const assign = (tile: Tile) => {
    const now = store.get();
    const cell = now.ui.mode === 'tile' ? now.ui.selectedCell : null;
    const band = now.doc.active === 'wall' ? now.ui.selectedBand : null;
    if (cell) store.commit((d) => act.assignTile(d, cell, tile.id, catalog));
    else if (band !== null) store.commit((d) => act.setBandTile(d, band, tile.id, catalog));
    else ctx.toast(doc.active === 'wall' ? 'Select a band in Row mode, or a tile in Tile mode, first.' : 'Select a tile in Tile mode first.');
  };

  const root = h('div', { class: 'tab tab-tiles' }, h('p', { class: `tab-hint${tileTarget || bandTarget ? ' is-ready' : ''}` }, hint));
  const tiles = catalog.tilesOf(plan.layout.seriesId);
  for (const role of ROLE_ORDER) {
    const group = tiles.filter((t) => t.role === role);
    if (group.length === 0) continue;
    const grid = h('div', { class: 'tile-grid' });
    for (const tile of group) {
      grid.append(
        h(
          'button',
          { type: 'button', class: 'tile-choice', onclick: () => assign(tile), 'aria-label': `${tile.name}, ${tile.widthMm} by ${tile.heightMm} mm` },
          h('span', { class: 'tile-thumb' }, tileThumb(tile.id, catalog, textures, 44, 60)),
          h('span', { class: 'tile-name' }, tile.name),
          h('span', { class: 'tile-meta' }, `${tile.widthMm} × ${tile.heightMm} · ${tile.finish}`),
          h('span', { class: 'tile-meta' }, `${tile.tilesPerBox} per box`),
        ),
      );
    }
    root.append(section(ROLE_TITLES[role], grid));
  }

  if (Object.keys(plan.overrides).length > 0) {
    root.append(
      h(
        'button',
        { type: 'button', class: 'pill-button', onclick: () => store.commit((d) => act.resetTiles(d)) },
        icon(ICONS.reset),
        h('span', {}, `Reset tiles (${Object.keys(plan.overrides).length} changed)`),
      ),
    );
  }
  return root;
}
