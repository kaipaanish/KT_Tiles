import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const SAMPLES_DIR = fileURLToPath(new URL('./public/samples', import.meta.url));
const VIRTUAL_ID = 'virtual:samples';

/**
 * Lists the photos in public/samples (with credits from public/samples/credits.json), so a
 * photo dropped into that folder shows up under "Try a sample photo" without code changes.
 */
function samplePhotos(): Plugin {
  return {
    name: 'kt-sample-photos',
    resolveId(id) {
      return id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : null;
    },
    load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return null;
      const files = existsSync(SAMPLES_DIR) ? readdirSync(SAMPLES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort() : [];
      const creditsFile = join(SAMPLES_DIR, 'credits.json');
      const credits: Record<string, Record<string, string>> = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, 'utf8')) : {};
      const samples = files.map((file) => ({
        file,
        url: `samples/${file}`,
        title: credits[file]?.['title'] ?? file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
        credit: credits[file]?.['credit'] ?? '',
        licence: credits[file]?.['licence'] ?? '',
        source: credits[file]?.['source'] ?? '',
      }));
      return `export default ${JSON.stringify(samples)};`;
    },
    configureServer(server) {
      // A photo added to or removed from public/samples shows up on the next reload, without restarting `npm run dev`.
      server.watcher.add(SAMPLES_DIR);
      const refresh = (file: string) => {
        if (!normalize(file).startsWith(SAMPLES_DIR)) return;
        const graph = server.environments.client.moduleGraph;
        const mod = graph.getModuleById(`\0${VIRTUAL_ID}`);
        if (mod) graph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', refresh).on('unlink', refresh).on('change', refresh);
    },
  };
}

export default defineConfig({
  plugins: [samplePhotos()],
  // The segmentation worker is created as a module worker, so it is built as one.
  worker: { format: 'es' },
});
