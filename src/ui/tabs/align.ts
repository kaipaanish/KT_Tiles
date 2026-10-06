import {
  formatMm,
  resolveAlignment,
  suggestAlignments,
  type AlignmentSuggestion,
  type AxisAlignment,
  type Catalog,
  type Layout,
  type SuggestPriority,
  type XMode,
  type YMode,
} from '../../engine';
import * as act from '../../state/actions';
import { activeKind, activePlan } from '../../state/document';
import { h } from '../dom';
import type { TabContext } from './context';
import { numberInput, section } from './parts';

/** Once asked for, the suggestions stay listed (and keep updating) for the session. */
let showSuggestions = false;
/** Scroll the list into view the first time it appears (it starts below the fold on phones). */
let scrollToSuggestions = false;

const X_OPTIONS: readonly { mode: XMode; label: string }[] = [
  { mode: 'left', label: 'Left' },
  { mode: 'centre-joint', label: 'Centre joint' },
  { mode: 'centre-tile', label: 'Centre tile' },
  { mode: 'centre-motif', label: 'Centre motif' },
  { mode: 'centre-between-motifs', label: 'Between motifs' },
  { mode: 'right', label: 'Right' },
];
const WALL_Y_OPTIONS: readonly { mode: YMode; label: string }[] = [
  { mode: 'bottom', label: 'Full tile at bottom' },
  { mode: 'top', label: 'Full tile at top' },
];
const FLOOR_Y_OPTIONS: readonly { mode: YMode; label: string }[] = [
  { mode: 'bottom', label: 'Bottom' },
  { mode: 'centre-joint', label: 'Centre joint' },
  { mode: 'centre-tile', label: 'Centre tile' },
  { mode: 'centre-motif', label: 'Centre motif' },
  { mode: 'centre-between-motifs', label: 'Between motifs' },
  { mode: 'top', label: 'Top' },
];

function layoutHasMotif(layout: Layout, catalog: Catalog): boolean {
  if (layout.surface === 'floor') return catalog.design(layout.designId).motifCentre !== undefined;
  return layout.bands.some((band) => catalog.design(band.designId).motifCentre !== undefined);
}

function options<M extends XMode | YMode>(
  choices: readonly { mode: M; label: string }[],
  current: AxisAlignment<M>,
  hasMotif: boolean,
  apply: (axis: AxisAlignment<M>) => void,
): HTMLElement {
  return h(
    'div',
    { class: 'option-grid' },
    ...choices.map(({ mode, label }) => {
      const on = current.mode === mode;
      const noMotif = (mode === 'centre-motif' || mode === 'centre-between-motifs') && !hasMotif;
      return h(
        'button',
        {
          type: 'button',
          class: `option${on ? ' is-on' : ''}`,
          'aria-pressed': String(on),
          disabled: noMotif,
          title: noMotif ? 'This layout has no motif' : undefined,
          onclick: () => apply({ mode }),
        },
        label,
      );
    }),
  );
}

function customRow(label: string, value: number, active: boolean, apply: (mm: number) => void, min: number, max: number): HTMLElement {
  return h(
    'label',
    { class: `field custom-row${active ? ' is-on' : ''}` },
    h('span', {}, label),
    h('span', { class: 'field-input' }, numberInput(value, { min, max, step: 1, label, onCommit: apply }), h('span', { class: 'unit' }, 'mm')),
  );
}

export function alignTab(ctx: TabContext): HTMLElement {
  const { state, result, catalog, store } = ctx;
  const { doc } = state;
  const plan = activePlan(doc);
  const wall = activeKind(doc) === 'wall';
  const hasMotif = layoutHasMotif(plan.layout, catalog);
  const { w, h: th } = result.tile;
  const setX = (x: AxisAlignment<XMode>) => store.commit((d) => act.setAlignment(d, { ...activePlan(d).alignment, x }));
  const setY = (y: AxisAlignment<YMode>) => store.commit((d) => act.setAlignment(d, { ...activePlan(d).alignment, y }));

  const across = h(
    'div',
    {},
    options(X_OPTIONS, plan.alignment.x, hasMotif, setX),
    customRow('Custom offset', result.origin.x, plan.alignment.x.mode === 'custom', (mm) => setX({ mode: 'custom', offsetMm: mm }), -20000, 20000),
  );

  let up: HTMLElement;
  if (wall) {
    // The bottom row's height is easier to talk about than a negative offset.
    const bottomRow = result.edgeCuts.bottom ?? th;
    up = h(
      'div',
      {},
      options(WALL_Y_OPTIONS, plan.alignment.y, hasMotif, setY),
      customRow('Bottom row height', bottomRow, plan.alignment.y.mode === 'custom', (mm) => {
        const height = Math.min(th, Math.max(1, mm));
        setY(height >= th ? { mode: 'bottom' } : { mode: 'custom', offsetMm: height - th });
      }, 1, th),
    );
  } else {
    up = h(
      'div',
      {},
      options(FLOOR_Y_OPTIONS, plan.alignment.y, hasMotif, setY),
      customRow('Custom offset', result.origin.y, plan.alignment.y.mode === 'custom', (mm) => setY({ mode: 'custom', offsetMm: mm }), -20000, 20000),
    );
  }

  // Smallest acceptable cut, as a share of the tile on each axis. 33% means exactly a third.
  const fractionOf = (pct: number) => (pct === 33 ? 1 / 3 : pct / 100);
  const describe = (fraction: number) => {
    const pct = Math.round(fraction * 100);
    const across = formatMm(w * fraction);
    const upMm = formatMm(th * fraction);
    return w === th ? `${pct}% of a tile: ${across} mm` : `${pct}% of a tile: ${across} mm across, ${upMm} mm up`;
  };
  const value = h('span', { class: 'range-value' }, describe(doc.settings.minCutFraction));
  const slider = h('input', {
    type: 'range',
    min: 10,
    max: 50,
    step: 1,
    value: String(Math.round(doc.settings.minCutFraction * 100)),
    'aria-label': 'Smallest acceptable cut, as a percentage of a tile',
  });
  slider.addEventListener('input', () => {
    value.textContent = describe(fractionOf(Number(slider.value)));
  });
  slider.addEventListener('change', () => store.commit((d) => act.setSettings(d, { minCutFraction: fractionOf(Number(slider.value)) })));
  const minCut = h('div', { class: 'range-row' }, slider, value);

  return h(
    'div',
    { class: 'tab tab-align' },
    section(wall ? 'Across the wall' : 'Across (width)', across),
    section(wall ? 'Up the wall' : 'Along (length)', up),
    section('Smallest acceptable cut', minCut, 'Cuts smaller than this are slivers: hard to cut and they look like a mistake.'),
    section('Suggest alignment', suggestionsBlock(ctx)),
    section('Cuts now', cutsNow(ctx)),
  );
}

function suggestionsBlock(ctx: TabContext): HTMLElement {
  const { state, result, catalog, store } = ctx;
  const { doc } = state;
  const plan = activePlan(doc);
  const priority = doc.settings.suggestPriority;
  const setPriority = (p: SuggestPriority) => store.commit((d) => act.setSettings(d, { suggestPriority: p }));
  const segment = (p: SuggestPriority, label: string) =>
    h('button', { type: 'button', class: `segment${priority === p ? ' is-on' : ''}`, 'aria-pressed': String(priority === p), onclick: () => setPriority(p) }, label);
  const block = h(
    'div',
    { class: 'suggest' },
    h('div', { class: 'priority' }, h('span', { class: 'priority-label' }, 'Priority'), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Priority' }, segment('avoid-slivers', 'Avoid slivers'), segment('symmetric', 'Symmetric pattern'))),
  );

  if (!showSuggestions) {
    block.append(
      h('button', { type: 'button', class: 'pill-button primary', onclick: () => {
        showSuggestions = true;
        scrollToSuggestions = true;
        ctx.refresh();
      } }, 'Suggest alignment'),
    );
    return block;
  }

  const suggestions = suggestAlignments(plan.surface, plan.layout, catalog, { priority, minCutFraction: doc.settings.minCutFraction, current: plan.alignment });
  const isCurrent = (s: AlignmentSuggestion) => {
    const origin = resolveAlignment(plan.surface, plan.layout, s.alignment, catalog).origin;
    const near = (a: number, b: number, period: number) => {
      const d = (((a - b) % period) + period) % period;
      return d < 0.5 || period - d < 0.5;
    };
    return near(origin.x, result.origin.x, result.period.x) && near(origin.y, result.origin.y, result.period.y);
  };
  const list = h('ol', { class: 'suggestion-list' });
  suggestions.forEach((s, i) => {
    const current = isCurrent(s);
    const badges = [
      h('span', { class: `badge ${s.hasSliver ? 'is-bad' : 'is-good'}` }, s.hasSliver ? 'Slivers' : 'No slivers'),
      h('span', { class: `badge ${s.symmetric ? 'is-good' : 'is-bad'}` }, s.symmetric ? 'Symmetric' : 'Not symmetric'),
      s.cutMotifs === null ? null : h('span', { class: `badge ${s.cutMotifs === 0 ? 'is-good' : 'is-bad'}` }, s.cutMotifs === 0 ? 'Motifs whole' : `${s.cutMotifs} cut motif${s.cutMotifs === 1 ? '' : 's'}`),
      current ? h('span', { class: 'badge is-current' }, 'Current') : null,
    ];
    list.append(
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: `suggestion${current ? ' is-current' : ''}`, onclick: () => store.commit((d) => act.setAlignment(d, s.alignment)) },
          h('span', { class: 'suggestion-rank' }, String(i + 1)),
          h(
            'span',
            { class: 'suggestion-body' },
            h('span', { class: 'suggestion-label' }, s.label, s.sameAs.length > 0 ? h('span', { class: 'same-as' }, ` · same as ${s.sameAs.join(', ')}`) : null),
            h('span', { class: 'suggestion-text' }, s.explanation),
            h('span', { class: 'badges' }, ...badges),
          ),
        ),
      ),
    );
  });
  block.append(list, h('p', { class: 'tab-hint' }, 'Tap an option to apply it.'));
  if (scrollToSuggestions) {
    scrollToSuggestions = false;
    requestAnimationFrame(() => block.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  return block;
}

function cutsNow(ctx: TabContext): HTMLElement {
  const { result } = ctx;
  const { edgeCuts, minCutMm } = result;
  const rows = [
    ['Left', edgeCuts.left, minCutMm.x],
    ['Right', edgeCuts.right, minCutMm.x],
    ['Bottom', edgeCuts.bottom, minCutMm.y],
    ['Top', edgeCuts.top, minCutMm.y],
  ] as const;
  const list = h(
    'ul',
    { class: 'cut-list' },
    ...rows.map(([edge, size, min]) => {
      const sliver = size !== null && size < min - 1e-6;
      return h('li', { class: sliver ? 'is-sliver' : '' }, h('span', {}, edge), h('span', { class: 'cut-size' }, size === null ? 'full tile' : `${formatMm(size)} mm cut${sliver ? ' (sliver)' : ''}`));
    }),
  );
  const others = result.warnings.filter((w) => w.code !== 'sliver');
  return h('div', {}, list, ...others.map((w) => h('p', { class: 'warning-line' }, w.message)));
}
