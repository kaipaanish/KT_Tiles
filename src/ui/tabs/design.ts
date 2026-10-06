import { layoutSurface, presetsFor, type Layout, type Preset } from '../../engine';
import { drawScene } from '../../render/renderer';
import * as act from '../../state/actions';
import { activeFloor, activeKind, activePlan, activeWall } from '../../state/document';
import { designChoices } from '../designPicker';
import { h, icon, ICONS } from '../dom';
import { bandRangeLabel, rowsLabel } from '../labels';
import { designThumb } from '../thumbs';
import { fitView } from '../viewport';
import type { TabContext } from './context';
import { capitalise, section } from './parts';

export function designTab(ctx: TabContext): HTMLElement {
  const { doc } = ctx.state;
  const root = h('div', { class: 'tab tab-design' });
  root.append(section('Series', seriesList(ctx)));
  const floor = activeFloor(doc)?.layout;
  if (!floor) {
    root.append(section('Presets', presetList(ctx)));
    root.append(section('Bands', bandList(ctx), 'Listed from the top of the wall down; heights are measured from the floor.'));
  } else {
    root.append(
      section(
        'Floor design',
        designChoices(floor.seriesId, floor.designId, ctx.catalog, ctx.textures, (designId) => ctx.store.commit((d) => act.setFloorDesign(d, designId, ctx.catalog))),
      ),
    );
  }
  return root;
}

/** Only the series made for the current surface. */
function seriesList(ctx: TabContext): HTMLElement {
  const { state, catalog, store } = ctx;
  const current = activePlan(state.doc).layout.seriesId;
  const list = h('div', { class: 'series-list' });
  for (const series of catalog.seriesList(activeKind(state.doc))) {
    const tiles = catalog.tilesOf(series.id);
    const size = catalog.tileSize(series.id);
    const selected = series.id === current;
    list.append(
      h(
        'button',
        {
          type: 'button',
          class: `series-choice${selected ? ' is-selected' : ''}`,
          'aria-pressed': String(selected),
          onclick: () => store.commit((d) => act.setSeries(d, series.id, catalog)),
        },
        h('span', { class: 'swatches' }, ...tiles.slice(0, 4).map((t) => h('span', { class: 'swatch', style: { background: t.placeholder.colors[0] ?? '#ccc' } }))),
        h('span', { class: 'series-name' }, series.name),
        h('span', { class: 'series-meta' }, `${size.w} × ${size.h} mm · ${tiles[0]?.finish ?? ''}`),
      ),
    );
  }
  return list;
}

function describePreset(preset: Preset): string {
  return preset.bands
    .map((band) => {
      const role = capitalise(band.role);
      if (band.rows === 'fill') return preset.bands.length === 1 ? `${role} covers the wall` : `${role} fills the rest`;
      if (band.rows === 'unit') return `${role} × 1 repeat`;
      return `${role} × ${band.rows}`;
    })
    .join(', ');
}

/** The preset drawn small on this wall, so the choice is visual. */
function presetPreview(ctx: TabContext, layout: Layout): HTMLCanvasElement {
  const { doc } = ctx.state;
  const canvas = h('canvas', { class: 'preset-preview' });
  const width = 58;
  const height = 70;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const c2d = canvas.getContext('2d');
  if (!c2d) return canvas;
  const wall = activeWall(doc) ?? doc.wall;
  const result = layoutSurface(wall.surface, layout, wall.alignment, {}, ctx.catalog);
  const view = fitView(result.widthMm, result.heightMm, width, height, { top: 2, right: 2, bottom: 2, left: 2 });
  drawScene(
    c2d,
    { width, height, dpr },
    result,
    view,
    ctx.textures,
    { groutMm: 0, groutColor: doc.settings.groutColor, showCuts: false, showRepeat: false, showMotifs: false, showDims: false },
    {},
    '#ffffff',
  );
  return canvas;
}

function presetList(ctx: TabContext): HTMLElement {
  const { doc } = ctx.state;
  const { catalog, store } = ctx;
  const list = h('div', { class: 'preset-list' });
  const wall = activeWall(doc) ?? doc.wall;
  for (const { preset, bands } of presetsFor(wall.layout.seriesId, catalog)) {
    const selected = JSON.stringify(bands) === JSON.stringify(wall.layout.bands);
    list.append(
      h(
        'button',
        {
          type: 'button',
          class: `preset-choice${selected ? ' is-selected' : ''}`,
          'aria-pressed': String(selected),
          onclick: () => store.commit((d) => act.applyPreset(d, preset.id, catalog)),
        },
        presetPreview(ctx, { ...wall.layout, bands }),
        h('span', { class: 'preset-text' }, h('span', { class: 'preset-name' }, preset.name), h('span', { class: 'preset-desc' }, describePreset(preset))),
      ),
    );
  }
  return list;
}

/** The same actions as the Row handles, as a list. */
function bandList(ctx: TabContext): HTMLElement {
  const { state, result, catalog, textures, store } = ctx;
  const bands = (activeWall(state.doc) ?? state.doc.wall).layout.bands;
  const list = h('ol', { class: 'band-list' });
  for (let index = bands.length - 1; index >= 0; index--) {
    const band = bands[index];
    const extent = result.bands[index];
    if (!band || !extent) continue;
    const design = catalog.design(band.designId);
    const isTop = index === bands.length - 1;
    const selected = state.ui.selectedBand === index;
    const range = bandRangeLabel(extent, catalog).slice(design.name.length + 2);
    const select = () => store.setUi({ selectedBand: index });

    const thumb = h('button', { type: 'button', class: 'band-thumb', 'aria-label': `Change the design of the ${design.name} band` }, designThumb(design, catalog, textures, 30, 40));
    thumb.addEventListener('click', () => ctx.pickBandDesign(index, thumb));
    const info = h('button', { type: 'button', class: 'band-info', onclick: select, 'aria-label': `Select band: ${bandRangeLabel(extent, catalog)}` }, h('span', { class: 'band-name' }, design.name), h('span', { class: 'band-range' }, range));

    let rows: HTMLElement;
    if (band.rows === 'fill') {
      rows = h('button', { type: 'button', class: 'chip is-on', title: 'Fills the rest of the wall. Tap to fix its rows.', onclick: () => store.commit((d) => act.setBandFill(d, index, false, catalog)) }, 'Fills rest');
    } else {
      rows = h(
        'div',
        { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': `Fewer rows of ${design.name}`, disabled: band.rows <= design.rows, onclick: () => store.commit((d) => act.stepBandRows(d, index, -1, catalog)) }, icon(ICONS.minus)),
        h('span', { class: 'stepper-value' }, rowsLabel(band.rows)),
        h('button', { type: 'button', 'aria-label': `More rows of ${design.name}`, onclick: () => store.commit((d) => act.stepBandRows(d, index, 1, catalog)) }, icon(ICONS.plus)),
        isTop ? h('button', { type: 'button', class: 'chip', title: 'Fill the rest of the wall', onclick: () => store.commit((d) => act.setBandFill(d, index, true, catalog)) }, 'Fill') : null,
      );
    }
    const move = h(
      'div',
      { class: 'band-move' },
      h('button', { type: 'button', 'aria-label': `Move ${design.name} up`, disabled: isTop, onclick: () => store.commit((d) => act.moveBand(d, index, index + 1, catalog)) }, icon(chevron('up'))),
      h('button', { type: 'button', 'aria-label': `Move ${design.name} down`, disabled: index === 0, onclick: () => store.commit((d) => act.moveBand(d, index, index - 1, catalog)) }, icon(chevron('down'))),
    );
    const remove = h('button', { type: 'button', class: 'icon-button band-remove', 'aria-label': `Remove the ${design.name} band`, disabled: bands.length === 1, onclick: () => store.commit((d) => act.removeBand(d, index, catalog)) }, icon(ICONS.trash));
    list.append(h('li', { class: `band-row${selected ? ' is-selected' : ''}${extent.hidden ? ' is-hidden' : ''}` }, move, thumb, info, rows, remove));
  }
  return h(
    'div',
    {},
    list,
    h('button', { type: 'button', class: 'pill-button add-band', onclick: () => store.commit((d) => act.addBand(d, catalog)) }, icon(ICONS.plus), h('span', {}, 'Add band')),
  );
}

function chevron(direction: 'up' | 'down'): string {
  const d = direction === 'up' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6';
  return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
}
