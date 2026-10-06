import type { Tab } from '../state/store';
import { h } from './dom';

const TABS: { id: Tab; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'design', label: 'Design' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'align', label: 'Align' },
  { id: 'count', label: 'Count' },
];

/**
 * The panel with the Design, Tiles, Align and Count tabs: a bottom sheet on phones (tap a tab
 * to open it, tap it again to fold the sheet down) and a side panel on wide screens.
 */
export class Sheet {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly buttons = new Map<Tab, HTMLButtonElement>();
  private open = false;

  constructor(
    private readonly onTab: (tab: Tab) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    const tabs = h('div', { class: 'sheet-tabs', role: 'tablist', 'aria-label': 'Panels' });
    for (const { id, label } of TABS) {
      const button = h('button', { type: 'button', class: 'sheet-tab', role: 'tab', id: `tab-${id}`, 'aria-controls': 'sheet-body' }, label);
      button.addEventListener('click', () => this.select(id));
      this.buttons.set(id, button);
      tabs.append(button);
    }
    const grabber = h('button', { type: 'button', class: 'sheet-grabber', 'aria-label': 'Show or hide the panel' }, h('span', {}));
    grabber.addEventListener('click', () => this.setOpen(!this.open));
    this.body = h('div', { class: 'sheet-body', id: 'sheet-body', role: 'tabpanel' });
    this.el = h('aside', { class: 'sheet' }, grabber, tabs, this.body);
  }

  get isOpen(): boolean {
    return this.open || this.isSidePanel;
  }

  /** On wide screens the sheet is a side panel that is always open. */
  get isSidePanel(): boolean {
    return window.matchMedia('(min-width: 900px)').matches;
  }

  /** The Photo tab only shows in photo mode. */
  showPhotoTab(show: boolean): void {
    const button = this.buttons.get('photo');
    if (button) button.hidden = !show;
    this.el.classList.toggle('has-photo-tab', show);
  }

  setTab(tab: Tab): void {
    for (const [id, button] of this.buttons) {
      const on = id === tab;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }
    this.body.setAttribute('aria-labelledby', `tab-${tab}`);
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.el.classList.toggle('is-open', open);
    this.onToggle(open);
  }

  /** Replaces the tab's content, keeping the scroll position when it's the same tab. */
  render(content: HTMLElement, sameTab: boolean): void {
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(content);
    if (sameTab) this.body.scrollTop = scroll;
    else this.body.scrollTop = 0;
  }

  private select(tab: Tab): void {
    const current = this.buttons.get(tab)?.classList.contains('is-on');
    if (current && !this.isSidePanel) {
      this.setOpen(!this.open);
      return;
    }
    this.onTab(tab);
    this.setOpen(true);
  }
}
