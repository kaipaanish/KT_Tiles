type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> };

/** Creates an element: h('button', { class: 'x', onclick: fn, 'aria-label': 'Undo' }, 'Undo'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el && !key.includes('-')) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

/** An inline SVG icon from a path string, sized by CSS. */
export function icon(paths: string, label?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  svg.innerHTML = paths;
  return svg;
}

const stroke = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

export const ICONS = {
  undo: stroke('M9 14 4 9l5-5') + stroke('M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  redo: stroke('m15 14 5-5-5-5') + stroke('M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
  share: stroke('M12 3v12') + stroke('m7 8 5-5 5 5') + stroke('M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'),
  grip: '<g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>',
  plus: stroke('M12 5v14') + stroke('M5 12h14'),
  minus: stroke('M5 12h14'),
  fit: stroke('M4 9V4h5') + stroke('M20 9V4h-5') + stroke('M4 15v5h5') + stroke('M20 15v5h-5'),
  reset: stroke('M3 12a9 9 0 1 0 3-6.7') + stroke('M3 4v5h5'),
  close: stroke('M6 6l12 12') + stroke('M18 6 6 18'),
  eye: stroke('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z') + '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  trash: stroke('M4 7h16') + stroke('M10 11v6') + stroke('M14 11v6') + stroke('M6 7l1 13h10l1-13') + stroke('M9 7V4h6v3'),
  ruler: stroke('M3 17 17 3l4 4L7 21z') + stroke('m7 13 2 2') + stroke('m10 10 2 2') + stroke('m13 7 2 2'),
  pattern: stroke('M12 3v18') + stroke('M3 12h18') + stroke('m8 8-3 4 3 4') + stroke('m16 8 3 4-3 4'),
  rows: '<g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/></g>',
  tile: '<g fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></g>' + stroke('M15 9a4 4 0 1 0 1 4'),
};
