import { encodeTemporalDeltas, evaluateReconstructionAccuracy, ReconstructionMetrics } from './temporalCompression';
import { generateTemporalGaussianScene } from '../demo';

export interface CompressionBenchmarkResult {
  gaussianCount: number;
  frameCount: number;
  fps: number;
  metrics: ReconstructionMetrics;
  passed: boolean;
}

/**
 * Executes a deterministic numerical accuracy unit test for temporal delta compression.
 */
export function runTemporalCompressionTest(): CompressionBenchmarkResult {
  const { polynomials, scene } = generateTemporalGaussianScene(1200, 5.0, 30);
  const compressedSeq = encodeTemporalDeltas(polynomials, scene.duration, scene.fps);

  const testTimestamps = [0.0, 0.5, 1.25, 2.5, 3.75, 4.5, 5.0];
  const metrics = evaluateReconstructionAccuracy(polynomials, compressedSeq, testTimestamps);

  // Sub-millimeter accuracy threshold
  const passed = metrics.maxPositionError < 0.005;

  return {
    gaussianCount: polynomials.length,
    frameCount: compressedSeq.frameCount,
    fps: compressedSeq.fps,
    metrics,
    passed,
  };
}
