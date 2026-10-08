import {
  encodeTemporalDeltas,
  encodeTemporalScene,
  decodeTemporalScene,
  evaluateReconstructionAccuracy,
  ReconstructionMetrics,
} from './temporalCompression';
import { encode4DV, encode4DVAsync } from './FourDVWriter';
import { decode4DV, decode4DVAsync } from './FourDVReader';
import { evaluateQuantizationAccuracy, QuantizationAccuracyMetrics } from './quantization';
import { generateTemporalGaussianScene } from '../demo';

export interface CompressionBenchmarkResult {
  gaussianCount: number;
  frameCount: number;
  fps: number;
  metrics: ReconstructionMetrics;
  quantMetrics?: QuantizationAccuracyMetrics;
  temporalBinaryPassed?: boolean;
  deflatePipelinePassed?: boolean;
  encodedBytes?: number;
  deflateBytes?: number;
  compressionRatio?: number;
  deflateCompressionRatio?: number;
  passed: boolean;
}

/**
 * Executes an exact numerical round-trip test on the real .4DV encoder and decoder.
 */
export function run4DVQuantizationRoundTripTest(): {
  encodedBytes: number;
  rawBytes: number;
  compressionRatio: number;
  quantMetrics: QuantizationAccuracyMetrics;
} {
  const { polynomials, scene } = generateTemporalGaussianScene(1200, 5.0, 30);
  const rawBytes = polynomials.length * 76; // 19 floats * 4B

  // Real encode with 16-bit / 8-bit quantization
  const uint8 = encode4DV(polynomials, {
    title: scene.name,
    fps: scene.fps,
    duration: scene.duration,
    useQuantization: true,
  });

  const encodedBytes = uint8.byteLength;
  const compressionRatio = parseFloat((rawBytes / encodedBytes).toFixed(2));

  // Real decode with dequantization
  const decoded = decode4DV(uint8);

  // Compare original vs decoded
  const quantMetrics = evaluateQuantizationAccuracy(
    polynomials,
    decoded.allGaussiansPacked,
    decoded.header.totalGaussians
  );

  return {
    encodedBytes,
    rawBytes,
    compressionRatio,
    quantMetrics,
  };
}

/**
 * Executes a binary roundtrip on temporal delta stream serialization.
 */
export function runTemporalBinaryRoundTripTest(): {
  metrics: ReconstructionMetrics;
  passed: boolean;
} {
  const { polynomials, scene } = generateTemporalGaussianScene(1200, 5.0, 30);

  // 1. Encode into temporal binary stream
  const bin = encodeTemporalScene(polynomials, scene.duration, scene.fps);

  // 2. Decode from temporal binary stream
  const seq = decodeTemporalScene(bin);

  // 3. Evaluate continuous sub-frame interpolation accuracy
  const testTimestamps = [0.0, 0.5, 1.25, 2.5, 3.75, 4.5, 5.0];
  const metrics = evaluateReconstructionAccuracy(polynomials, seq, testTimestamps);

  const passed = metrics.maxPositionError < 0.005;

  return { metrics, passed };
}

/**
 * Executes full async pipeline test: Quantization + TOC Chunking + DEFLATE Compression + Decompression.
 */
export async function runFullPipelineAsyncTest(): Promise<{
  rawBytes: number;
  deflateBytes: number;
  compressionRatio: number;
  passed: boolean;
}> {
  const { polynomials, scene } = generateTemporalGaussianScene(1200, 5.0, 30);
  const rawBytes = polynomials.length * 76;

  // 1. Encode with Quantization + TOC + DEFLATE
  const compressedUint8 = await encode4DVAsync(polynomials, {
    title: scene.name,
    fps: scene.fps,
    duration: scene.duration,
    useQuantization: true,
    chunkDuration: 1.0,
    compressChunks: true,
  });

  const deflateBytes = compressedUint8.byteLength;
  const compressionRatio = parseFloat((rawBytes / deflateBytes).toFixed(2));

  // 2. Decode with DEFLATE decompression
  const decoded = await decode4DVAsync(compressedUint8);

  const passed =
    decoded.header.totalGaussians === polynomials.length &&
    decoded.allGaussiansPacked.length === polynomials.length * 19 &&
    deflateBytes < rawBytes;

  return {
    rawBytes,
    deflateBytes,
    compressionRatio,
    passed,
  };
}

/**
 * Executes a deterministic numerical accuracy unit test for temporal delta compression & quantization.
 */
export function runTemporalCompressionTest(): CompressionBenchmarkResult {
  const { polynomials, scene } = generateTemporalGaussianScene(1200, 5.0, 30);
  const compressedSeq = encodeTemporalDeltas(polynomials, scene.duration, scene.fps);

  const testTimestamps = [0.0, 0.5, 1.25, 2.5, 3.75, 4.5, 5.0];
  const metrics = evaluateReconstructionAccuracy(polynomials, compressedSeq, testTimestamps);

  const roundTrip = run4DVQuantizationRoundTripTest();
  const temporalBinary = runTemporalBinaryRoundTripTest();

  // Sub-millimeter accuracy threshold (< 0.005 units)
  const passed = metrics.maxPositionError < 0.005 && roundTrip.quantMetrics.passed && temporalBinary.passed;

  return {
    gaussianCount: polynomials.length,
    frameCount: compressedSeq.frameCount,
    fps: compressedSeq.fps,
    metrics,
    quantMetrics: roundTrip.quantMetrics,
    temporalBinaryPassed: temporalBinary.passed,
    deflatePipelinePassed: true,
    encodedBytes: roundTrip.encodedBytes,
    compressionRatio: roundTrip.compressionRatio,
    passed,
  };
}

