import { formatMm } from '../../engine';
import type { PhotoMode } from '../../photo/photoMode';
import { PHOTO_ICONS } from '../../photo/photoView';
import { labelShares } from '../../photo/regions';
import * as act from '../../state/actions';
import { activeKind, photoSurface, photoSurfaceName } from '../../state/document';
import type { AppState } from '../../state/store';
import { h, icon } from '../dom';
import type { TabContext } from './context';
import { section } from './parts';

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** What the wall finder is doing, in one line. */
function statusLine(mode: PhotoMode): string {
  const status = mode.status;
  switch (status.state) {
    case 'idle':
      return 'Walls and floor are found once you open a photo.';
    case 'downloading':
      return `Getting the wall finder ready (${(status.total / 1e6).toFixed(1)} MB, first time only)…`;
    case 'running':
      return 'Finding walls and floor…';
    case 'failed':
      return "Couldn't find the walls automatically. Check the connection and try again.";
    case 'ready': {
      const shares = labelShares(status.segmentation);
      const found = (['wall', 'floor', 'ceiling'] as const).filter((name) => shares[name] > 0.005).map((name) => `${name} ${percent(shares[name])}`);
      const { load, run, refine } = status.segmentation.timings;
      const seconds = ((load + run + refine) / 1000).toFixed(1);
      return `${found.length ? `Found ${found.join(', ')} of the photo` : 'No wall or floor found'}, in ${seconds} s on this device.`;
    }
  }
}

/** Photo mode's own tab: the photo, the walls and floor found in it, other photos and the samples' credits. */
export function photoTab(ctx: TabContext): HTMLElement {
  const mode = ctx.photo;
  const photo = mode.photo;
  const root = h('div', { class: 'tab tab-photo' });

  root.append(
    section(
      'This photo',
      photo
        ? h('p', { class: 'photo-info' }, h('strong', {}, photo.name), h('span', {}, ` · ${photo.width} × ${photo.height} px`))
        : h('p', { class: 'tab-hint' }, 'No photo yet. Take one, choose one from your gallery, or try a sample.'),
      'Photos stay on this device. Nothing is uploaded or saved.',
    ),
  );

  if (photo) root.append(surfaceList(ctx));
  if (photo && mode.surfaces.some((s) => s.fit.confirmed)) root.append(lightingSection(mode));

  if (photo) {
    const content = h('div', { class: 'photo-found' }, h('p', { class: 'photo-status' }, statusLine(mode)));
    if (mode.status.state === 'ready') {
      content.append(
        h(
          'button',
          { type: 'button', class: `option${mode.showRegions ? ' is-on' : ''}`, 'aria-pressed': String(mode.showRegions), onclick: () => mode.setShowRegions(!mode.showRegions) },
          'Show regions',
        ),
      );
      content.append(h('p', { class: 'sample-credit' }, mode.status.segmentation.model));
    }
    if (mode.status.state === 'failed') {
      content.append(h('button', { type: 'button', class: 'pill-button', onclick: () => mode.retry() }, 'Try again'));
    }
    root.append(section('Walls and floor', content, 'The wall finder runs on this device. It is downloaded the first time (4–15 MB, depending on the device) and kept by the browser; your photo never leaves the device.'));
  }

  root.append(
    section(
      photo ? 'Use another photo' : 'Get a photo',
      h(
        'div',
        { class: 'photo-sources' },
        h('button', { type: 'button', class: 'pill-button primary', onclick: () => void mode.take() }, icon(PHOTO_ICONS.camera), h('span', {}, 'Take photo')),
        h('button', { type: 'button', class: 'pill-button', onclick: () => void mode.choose() }, icon(PHOTO_ICONS.gallery), h('span', {}, 'Choose from gallery')),
      ),
    ),
  );

  if (mode.samples.length > 0) {
    const list = h('div', { class: 'sample-list' });
    for (const sample of mode.samples) {
      const credit = [sample.credit, sample.licence].filter(Boolean).join(', ');
      list.append(
        h(
          'div',
          { class: 'sample-row' },
          h('button', { type: 'button', class: 'pill-button sample-button', onclick: () => void mode.useSample(sample) }, sample.title),
          credit ? h('p', { class: 'sample-credit' }, credit, sample.source ? ' · ' : '', sample.source ? h('a', { href: sample.source, target: '_blank', rel: 'noopener' }, 'source') : null) : null,
        ),
      );
    }
    root.append(section('Sample photos', list));
  }
  return root;
}

/** The walls and floor picked in this photo, each with its own design. */
function surfaceList(ctx: TabContext): HTMLElement {
  const { state, catalog, store } = ctx;
  const doc = state.doc;
  const surfaces = ctx.photo.surfaces;
  if (surfaces.length === 0) return section('Tiled surfaces', h('p', { class: 'tab-hint' }, 'Tap a wall or the floor in the photo to tile it.'));
  const list = h('ul', { class: 'surface-list' });
  for (const surface of surfaces) {
    const name = photoSurfaceName(doc, surface.id);
    const active = doc.active === surface.id;
    const { widthMm, heightMm } = surface.plan.surface;
    const size = surface.fit.confirmed ? `${formatMm(widthMm)} × ${formatMm(heightMm)} mm` : 'placing its corners';
    const button = (label: string, onclick: () => void, aria?: string) =>
      h('button', { type: 'button', class: 'pill-button', onclick, 'aria-label': aria ?? `${label}: ${name}` }, label);
    list.append(
      h(
        'li',
        { class: `surface-row${active ? ' is-active' : ''}` },
        h('span', { class: 'surface-name' }, name),
        h('span', { class: 'surface-meta' }, `${catalog.series(surface.plan.layout.seriesId).name} · ${size}`),
        h(
          'span',
          { class: 'surface-actions' },
          active ? null : button('Edit', () => store.commit((d) => act.setActive(d, surface.id))),
          surface.fit.confirmed ? button('Corners', () => ctx.photo.adjustCorners(surface.id), `Adjust the corners: ${name}`) : null,
          button('Remove', () => store.commit((d) => act.removePhotoSurface(d, surface.id))),
        ),
      ),
    );
  }
  return section('Tiled surfaces', list, 'Each has its own design: change it in the Design, Tiles, Align and Count tabs.');
}

/** The Room lighting slider, and a note where tiles can't be drawn. */
function lightingSection(mode: PhotoMode): HTMLElement {
  const percentOf = (light: number) => `${Math.round(light * 100)}%`;
  const value = h('span', { class: 'range-value' }, percentOf(mode.light));
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(mode.light * 100)), 'aria-label': 'Room lighting' });
  slider.addEventListener('input', () => {
    mode.setLight(Number(slider.value) / 100);
    value.textContent = percentOf(mode.light);
  });
  const content = h('div', { class: 'range-row' }, h('label', { class: 'field' }, h('span', {}, 'Room lighting'), value), slider);
  if (!mode.compositor) content.append(h('p', { class: 'tab-hint' }, "This browser can't draw tiles on the photo (WebGL 2 is off), so a grid shows where they go."));
  return section('Look', content, "How much of the photo's own light and shadow shows on the new tiles.");
}

/** In photo mode, a line at the top of the other tabs saying what they change. */
export function photoContext(state: AppState): HTMLElement | null {
  if (state.ui.view !== 'photo') return null;
  const surface = photoSurface(state.doc, state.doc.active);
  if (surface) return h('p', { class: 'photo-context' }, 'Editing ', h('strong', {}, photoSurfaceName(state.doc, surface.id)), ' in the photo.');
  return h('p', { class: 'photo-context' }, `Tap a wall or the floor in the photo to tile it. Until then, this changes the designer's ${activeKind(state.doc)}.`);
}
