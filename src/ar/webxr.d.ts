/**
 * The parts of WebXR (Device API, AR module, hit test, anchors, DOM overlay, depth sensing,
 * plane detection) that the AR screen uses. TypeScript's DOM library doesn't include WebXR, and
 * these few declarations save a dependency.
 */

type XRSessionMode = 'inline' | 'immersive-vr' | 'immersive-ar';
type XRReferenceSpaceType = 'viewer' | 'local' | 'local-floor' | 'bounded-floor' | 'unbounded';

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  domOverlay?: { root: Element };
  depthSensing?: { usagePreference: string[]; dataFormatPreference: string[] };
}

interface XRSystem extends EventTarget {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, init?: XRSessionInit): Promise<XRSession>;
}

interface Navigator {
  readonly xr?: XRSystem;
}

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer;
  depthNear?: number;
  depthFar?: number;
}

interface XRSession extends EventTarget {
  readonly enabledFeatures?: readonly string[];
  readonly domOverlayState?: { type: string } | null;
  readonly depthUsage?: string;
  readonly depthDataFormat?: string;
  updateRenderState(state: XRRenderStateInit): void;
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<XRReferenceSpace>;
  requestHitTestSource?(options: { space: XRSpace; entityTypes?: string[] }): Promise<XRHitTestSource>;
  requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number;
  end(): Promise<void>;
  addEventListener(type: 'end', listener: () => void): void;
  addEventListener(type: 'select', listener: (event: XRInputSourceEvent) => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface XRSpace extends EventTarget {}
interface XRReferenceSpace extends XRSpace {}

interface XRRigidTransform {
  readonly position: DOMPointReadOnly;
  readonly orientation: DOMPointReadOnly;
  readonly matrix: Float32Array;
  readonly inverse: XRRigidTransform;
}

interface XRPose {
  readonly transform: XRRigidTransform;
  readonly emulatedPosition: boolean;
}

interface XRView {
  readonly eye: 'none' | 'left' | 'right';
  readonly projectionMatrix: Float32Array;
  readonly transform: XRRigidTransform;
}

interface XRViewerPose extends XRPose {
  readonly views: readonly XRView[];
}

interface XRHitTestSource {
  cancel(): void;
}

interface XRAnchor {
  readonly anchorSpace: XRSpace;
  delete(): void;
}

interface XRHitTestResult {
  getPose(baseSpace: XRSpace): XRPose | null;
  createAnchor?(): Promise<XRAnchor>;
}

interface XRPlane {
  readonly orientation?: 'horizontal' | 'vertical';
}

interface XRFrame {
  readonly session: XRSession;
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
  getPose(space: XRSpace, baseSpace: XRSpace): XRPose | null;
  getHitTestResults(source: XRHitTestSource): readonly XRHitTestResult[];
  readonly trackedAnchors?: ReadonlySet<XRAnchor>;
  readonly detectedPlanes?: ReadonlySet<XRPlane>;
}

interface XRInputSourceEvent extends Event {
  readonly frame: XRFrame;
}

interface XRViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface XRWebGLLayer {
  readonly framebuffer: WebGLFramebuffer | null;
  readonly framebufferWidth: number;
  readonly framebufferHeight: number;
  getViewport(view: XRView): XRViewport | null;
}

declare var XRWebGLLayer: {
  prototype: XRWebGLLayer;
  new (session: XRSession, context: WebGL2RenderingContext, init?: { alpha?: boolean; antialias?: boolean }): XRWebGLLayer;
};

interface WebGLContextAttributes {
  xrCompatible?: boolean;
}

interface WebGL2RenderingContext {
  makeXRCompatible(): Promise<void>;
}
