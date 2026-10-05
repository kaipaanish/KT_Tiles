import { h } from '../dom';

/** A titled block inside a tab. */
export function section(title: string, content: Node, hint?: string): HTMLElement {
  return h(
    'section',
    { class: 'tab-section' },
    h('h2', { class: 'tab-heading' }, title),
    hint ? h('p', { class: 'tab-hint' }, hint) : null,
    content,
  );
}

/** A number input that applies its value on change (Enter or leaving the field). */
export function numberInput(value: number, options: { min: number; max: number; step: number; label: string; onCommit: (value: number) => void }): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    inputMode: 'decimal',
    min: options.min,
    max: options.max,
    step: options.step,
    value: String(Math.round(value * 10) / 10),
    'aria-label': options.label,
  });
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (input.value !== '' && Number.isFinite(n)) options.onCommit(n);
  });
  return input;
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
