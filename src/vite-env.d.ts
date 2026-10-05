/// <reference types="vite/client" />

interface Window {
  /** Set with ?debug=1, for the browser check script. */
  ktDebug?: Record<string, (...args: never[]) => unknown>;
}
