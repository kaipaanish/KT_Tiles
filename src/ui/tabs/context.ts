import type { Catalog, LayoutResult } from '../../engine';
import type { TextureCache } from '../../render/textureCache';
import type { AppState, Store } from '../../state/store';

/** What a bottom-sheet tab needs to draw itself and make changes. */
export interface TabContext {
  state: AppState;
  result: LayoutResult;
  catalog: Catalog;
  textures: TextureCache;
  store: Store;
  /** Opens the design picker for a wall band, next to an element. */
  pickBandDesign(index: number, anchor: Element): void;
  toast(message: string): void;
  /** Draws the tab again, e.g. after it changed something of its own. */
  refresh(): void;
}
