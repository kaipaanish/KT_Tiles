/// <reference types="vite/client" />

interface Window {
  /** Set with ?debug=1, for the browser check script. */
  ktDebug?: Record<string, (...args: never[]) => unknown>;
}

/** The photos in public/samples, listed at build time (see vite.config.ts). */
declare module 'virtual:samples' {
  const samples: { file: string; url: string; title: string; credit: string; licence: string; source: string }[];
  export default samples;
}
