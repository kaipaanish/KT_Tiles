/**
 * Starting an AR session with WebXR: whether this browser can, and the richest set of features
 * the phone will grant.
 */

export interface ArSupport {
  ok: boolean;
  /** Why not, in a sentence for the screen. */
  reason: string;
}

export async function checkArSupport(): Promise<ArSupport> {
  if (!window.isSecureContext) return { ok: false, reason: 'AR needs the page served over https.' };
  if (!navigator.xr) return { ok: false, reason: 'This browser has no WebXR. AR needs Chrome on an Android phone with Google Play Services for AR.' };
  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) return { ok: false, reason: "This device or browser can't run AR (WebXR immersive-ar). AR needs Chrome on an Android phone with Google Play Services for AR." };
  return { ok: true, reason: '' };
}

/** One way of asking for a session, from the most features to the fewest. */
interface Attempt {
  label: string;
  init: (overlay: HTMLElement) => XRSessionInit;
}

const EXTRAS = ['dom-overlay', 'anchors', 'plane-detection', 'light-estimation'];

/**
 * Depth sensing must say how it wants the data, and its option names have changed between
 * versions of the spec: an unknown name fails the whole request, so each is tried in turn.
 */
export const ATTEMPTS: readonly Attempt[] = [
  {
    label: 'all features, depth as luminance-alpha',
    init: (overlay) => ({
      requiredFeatures: ['hit-test'],
      optionalFeatures: [...EXTRAS, 'depth-sensing'],
      domOverlay: { root: overlay },
      depthSensing: { usagePreference: ['cpu-optimized', 'gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
    }),
  },
  {
    label: 'all features, depth as unsigned-short',
    init: (overlay) => ({
      requiredFeatures: ['hit-test'],
      optionalFeatures: [...EXTRAS, 'depth-sensing'],
      domOverlay: { root: overlay },
      depthSensing: { usagePreference: ['cpu-optimized', 'gpu-optimized'], dataFormatPreference: ['unsigned-short', 'float32'] },
    }),
  },
  {
    label: 'without depth sensing',
    init: (overlay) => ({ requiredFeatures: ['hit-test'], optionalFeatures: EXTRAS, domOverlay: { root: overlay } }),
  },
  {
    label: 'hit test and overlay only',
    init: (overlay) => ({ requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } }),
  },
];

export interface StartedSession {
  session: XRSession;
  /** Which attempt worked, and why the ones before it didn't. */
  attempt: string;
  failures: string[];
}

/**
 * Asks for an AR session, starting from attempt `from`. A failure that needs a fresh tap (the
 * browser wants a user gesture for each request) stops early: `next` says where to carry on.
 */
export async function startArSession(overlay: HTMLElement, from = 0): Promise<StartedSession | { failures: string[]; next: number | null }> {
  const failures: string[] = [];
  for (let i = from; i < ATTEMPTS.length; i++) {
    const attempt = ATTEMPTS[i]!;
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', attempt.init(overlay));
      return { session, attempt: `${attempt.label} (${i + 1} of ${ATTEMPTS.length})`, failures };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      failures.push(`${attempt.label}: ${name}${error instanceof Error && error.message ? ` (${error.message})` : ''}`);
      // Refused for want of a tap: the first try of a tap had one, so that one was refused for
      // another reason and the next tap moves on; a later try needs a tap of its own.
      if (name === 'SecurityError' || name === 'NotAllowedError' || name === 'InvalidStateError') {
        const next = i > from ? i : i + 1;
        return { failures, next: next < ATTEMPTS.length ? next : null };
      }
    }
  }
  return { failures, next: null };
}
