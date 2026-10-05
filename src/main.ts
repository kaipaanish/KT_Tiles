import { catalog } from './designs/catalog';

// Step 1 ships the layout engine only; the designer UI replaces this in step 2.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `KT Tile Designer: layout engine ready with ${catalog.seriesList().length} series. The designer arrives in step 2.`;
}
