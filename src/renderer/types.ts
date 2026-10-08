/**
 * 3D / 4D Gaussian types and interface definitions.
 */

export interface Gaussian3D {
  position: [number, number, number];
  scale: [number, number, number];
  color: [number, number, number]; // Normalized RGB [0..1]
  opacity: number;                 // Normalized alpha [0..1]
}

export interface GaussianRenderStats {
  fps: number;
  frameTimeMs: number;
  gaussianCount: number;
  viewportWidth: number;
  viewportHeight: number;
}
