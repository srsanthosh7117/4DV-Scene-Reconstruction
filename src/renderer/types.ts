/**
 * 3D Gaussian primitive representation
 */
export interface Gaussian3D {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number, number]; // Quaternion [x, y, z, w]
  color: [number, number, number];              // Normalized RGB [0..1]
  opacity: number;                              // Normalized alpha [0..1]
}

/**
 * Temporal Gaussian representation with polynomial motion coefficients:
 * Position(t) = P0 + P1*t + P2*t^2 + Harmonic(amp, freq, phase)
 */
export interface Gaussian4DPolynomial {
  position: [number, number, number]; // Base position P0
  scale: [number, number, number];
  rotation?: [number, number, number, number];
  color: [number, number, number];
  opacity: number;

  motionDegree: number; // 0 = static, 1 = linear, 2 = quadratic, 3 = cubic
  motionP1?: [number, number, number]; // Linear velocity
  motionP2?: [number, number, number]; // Acceleration
  motionP3?: [number, number, number]; // Harmonic parameters: [Amplitude, Frequency, Phase]
}

/**
 * Discrete Keyframe representation for multi-frame temporal sequences
 */
export interface TemporalKeyframe {
  timestamp: number; // in seconds
  positions: Float32Array; // [x0, y0, z0, x1, y1, z1, ...]
  scales?: Float32Array;
  colors?: Float32Array;
  opacities?: Float32Array;
}

/**
 * Temporal 4D Gaussian Scene data structure
 */
export interface TemporalScene4D {
  name: string;
  duration: number;        // Total duration in seconds
  fps: number;
  frameCount: number;
  gaussianCount: number;
  staticCount: number;
  dynamicCount: number;

  // Base attributes (Position, Scale, Color, Opacity)
  basePositions: Float32Array;
  baseScales: Float32Array;
  baseColors: Float32Array;
  baseOpacities: Float32Array;

  // Temporal polynomial trajectories or discrete keyframe table
  keyframes: TemporalKeyframe[];
  polynomials?: Gaussian4DPolynomial[];
}

export interface GaussianRenderStats {
  fps: number;
  frameTimeMs: number;
  gaussianCount: number;
  viewportWidth: number;
  viewportHeight: number;
  currentTime: number;
  totalDuration: number;
}
