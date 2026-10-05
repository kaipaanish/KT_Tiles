import { h } from './dom';

/**
 * A floating panel anchored to a point or element. Closes on Escape, on an outside press,
 * or when another popover opens.
 */
let openPopover: Popover | null = null;

export class Popover {
  readonly el: HTMLDivElement;
  private readonly onOutside = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node) && !this.anchor?.contains(e.target as Node)) this.close();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };
  private anchor: Element | null = null;
  onClose: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    title: string,
    className = '',
  ) {
    this.el = h('div', { class: `popover ${className}`, role: 'dialog', 'aria-label': title });
  }

  get isOpen(): boolean {
    return this.el.isConnected;
  }

  /** Opens next to an element, or at a point (CSS px relative to the host). */
  open(content: Node, at: Element | { x: number; y: number }): void {
    if (openPopover && openPopover !== this) openPopover.close();
    openPopover = this;
    this.anchor = at instanceof Element ? at : null;
    this.el.replaceChildren(content);
    this.host.append(this.el);
    this.place(at);
    window.setTimeout(() => {
      document.addEventListener('pointerdown', this.onOutside, true);
      document.addEventListener('keydown', this.onKey);
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.remove();
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey);
    if (openPopover === this) openPopover = null;
    this.onClose?.();
  }

  private place(at: Element | { x: number; y: number }): void {
    const host = this.host.getBoundingClientRect();
    const margin = 8;
    let x: number;
    let y: number;
    if (at instanceof Element) {
      const r = at.getBoundingClientRect();
      x = r.left - host.left;
      y = r.bottom - host.top + 6;
    } else {
      x = at.x;
      y = at.y + 10;
    }
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    x = Math.min(Math.max(margin, x), host.width - w - margin);
    if (y + hgt > host.height - margin) y = Math.max(margin, (at instanceof Element ? at.getBoundingClientRect().top - host.top : y) - hgt - 10);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
