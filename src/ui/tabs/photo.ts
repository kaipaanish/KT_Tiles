import { PHOTO_ICONS } from '../../photo/photoView';
import { h, icon } from '../dom';
import type { TabContext } from './context';
import { section } from './parts';

/** Photo mode's own tab: the photo, where to get another, and the sample photos' credits. */
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
