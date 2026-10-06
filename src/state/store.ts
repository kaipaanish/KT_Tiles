import type { DesignDoc } from './document';

export type Mode = 'pattern' | 'row' | 'tile';
export type Tab = 'design' | 'tiles' | 'align' | 'count' | 'photo';
/** The designer (flat surfaces) or photo mode (a real room). */
export type View = 'designer' | 'photo';

export interface Toggles {
  showCuts: boolean;
  showRepeat: boolean;
  showMotifs: boolean;
  showDims: boolean;
}

/** View and selection state: not saved and not undoable. */
export interface UiState {
  view: View;
  mode: Mode;
  tab: Tab;
  selectedBand: number | null;
  selectedCell: { col: number; row: number } | null;
  toggles: Toggles;
}

export interface AppState {
  doc: DesignDoc;
  ui: UiState;
  canUndo: boolean;
  canRedo: boolean;
}

type Listener = (state: AppState, previous: AppState) => void;

const HISTORY_LIMIT = 100;

/**
 * A small store. Every document change is one undo step; a gesture (a drag) previews many
 * changes and records a single step when it ends.
 */
export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private past: DesignDoc[] = [];
  private future: DesignDoc[] = [];
  /** The document before the current gesture, if one is running. */
  private gestureStart: DesignDoc | null = null;

  constructor(doc: DesignDoc, ui: UiState) {
    this.state = { doc, ui, canUndo: false, canRedo: false };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Records a document change as one undo step. Returning the same document does nothing. */
  commit(update: (doc: DesignDoc) => DesignDoc): void {
    if (this.gestureStart) this.endGesture();
    const doc = update(this.state.doc);
    if (doc === this.state.doc) return;
    this.past = [...this.past, this.state.doc].slice(-HISTORY_LIMIT);
    this.future = [];
    this.set({ doc });
  }

  beginGesture(): void {
    this.gestureStart ??= this.state.doc;
  }

  /** Changes the document during a gesture without recording history. */
  preview(update: (doc: DesignDoc) => DesignDoc): void {
    this.beginGesture();
    const doc = update(this.state.doc);
    if (doc !== this.state.doc) this.set({ doc });
  }

  endGesture(): void {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (!start || start === this.state.doc) return;
    this.past = [...this.past, start].slice(-HISTORY_LIMIT);
    this.future = [];
    this.set({});
  }

  cancelGesture(): void {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start && start !== this.state.doc) this.set({ doc: start });
  }

  undo(): void {
    if (this.gestureStart) this.cancelGesture();
    const previous = this.past[this.past.length - 1];
    if (!previous) return;
    this.past = this.past.slice(0, -1);
    this.future = [this.state.doc, ...this.future];
    this.set({ doc: previous });
  }

  redo(): void {
    if (this.gestureStart) this.cancelGesture();
    const [next, ...rest] = this.future;
    if (!next) return;
    this.future = rest;
    this.past = [...this.past, this.state.doc];
    this.set({ doc: next });
  }

  setUi(patch: Partial<UiState>): void {
    this.set({ ui: { ...this.state.ui, ...patch } });
  }

  /** Replaces the document and clears history, e.g. after loading a saved design. */
  reset(doc: DesignDoc): void {
    this.past = [];
    this.future = [];
    this.gestureStart = null;
    this.set({ doc });
  }

  private set(patch: Partial<AppState>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    for (const listener of this.listeners) listener(this.state, previous);
  }
}
