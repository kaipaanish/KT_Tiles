import type { Catalog } from '../engine';
import { drawDesignPreview } from '../render/previews';
import type { TextureCache } from '../render/textureCache';
import { h } from './dom';

/** A grid of a series' designs with small previews. */
export function designChoices(
  seriesId: string,
  selectedId: string | null,
  catalog: Catalog,
  textures: TextureCache,
  onPick: (designId: string) => void,
): HTMLElement {
  const list = h('div', { class: 'design-choices' });
  for (const design of catalog.designsOf(seriesId)) {
    const preview = h('canvas', { class: 'design-preview' });
    drawDesignPreview(preview, design, catalog, textures, 56, 64);
    const size = design.cols * design.rows === 1 ? 'Plain' : `${design.cols} × ${design.rows} tiles`;
    list.append(
      h(
        'button',
        {
          class: `design-choice${design.id === selectedId ? ' is-selected' : ''}`,
          type: 'button',
          'aria-pressed': String(design.id === selectedId),
          onclick: () => onPick(design.id),
        },
        h('span', { class: 'design-thumb' }, preview),
        h('span', { class: 'design-name' }, design.name),
        h('span', { class: 'design-size' }, size),
      ),
    );
  }
  return list;
}
