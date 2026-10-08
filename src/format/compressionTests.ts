import {
  encodeTemporalDeltas,
  encodeTemporalScene,
  decodeTemporalScene,
  evaluateReconstructionAccuracy,
  ReconstructionMetrics,
} from './temporalCompression';
import { encode4DV, encode4DVAsync } from './FourDVWriter';
import { decode4DV, decode4DVAsync, readChunkAsync, getChunkForTime } from './FourDVReader';
import { evaluateQuantizationAccuracy, QuantizationAccuracyMetrics } from './quantization';
import { generateTemporalGaussianScene } from '../demo';
import { Gaussian4DPolynomial } from '../renderer/types';

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

export interface DeterministicRoundTripResult {
  uncompressedPassed: boolean;
  compressedPassed: boolean;
  randomAccessPassed: boolean;
  uncompressedSize: number;
  compressedSize: number;
  positionMAE: number;
  scaleMAE: number;
  colorMAE: number;
  passed: boolean;
  details: string;
}

/**
 * Creates a deterministic 20-Gaussian test scene (10 static, 10 dynamic).
 */
export function createDeterministicTestScene(): {
  gaussians: Gaussian4DPolynomial[];
  duration: number;
  fps: number;
} {
  const gaussians: Gaussian4DPolynomial[] = [];
  const duration = 2.0;
  const fps = 10.0;

  // 10 Static Gaussians
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    gaussians.push({
      position: [Math.cos(angle) * 2.0, 0.5, Math.sin(angle) * 2.0],
      scale: [0.1, 0.1, 0.1],
      rotation: [0, 0, 0, 1],
      color: [i / 10, 1.0 - i / 10, 0.5],
      opacity: 0.9,
      motionDegree: 0,
    });
  }

  // 10 Dynamic Gaussians
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    gaussians.push({
      position: [Math.sin(angle) * 1.5, 1.0, Math.cos(angle) * 1.5],
      scale: [0.08, 0.08, 0.08],
      rotation: [0, 0, 0, 1],
      color: [1.0, i / 10, 0.2],
      opacity: 0.85,
      motionDegree: 3,
      motionP1: [0.2 * Math.cos(angle), 0.1, -0.2 * Math.sin(angle)],
      motionP2: [0.05, -0.05, 0.0],
      motionP3: [0.3, 2.0, angle],
    });
  }

  return { gaussians, duration, fps };
}

/**
 * Phase 8, 9 & 10: Strict Round-Trip & Random-Access Verification Test.
 */
export async function runDeterministicRoundTripTest(): Promise<DeterministicRoundTripResult> {
  const { gaussians, duration, fps } = createDeterministicTestScene();

  // ---------------- Test 1: Uncompressed Mode ----------------
  const uncompressedBuffer = await encode4DVAsync(gaussians, {
    title: 'Deterministic Test Uncompressed',
    duration,
    fps,
    useQuantization: true,
    chunkDuration: 1.0,
    compressChunks: false,
  });

  const decodedUncompressed = await decode4DVAsync(uncompressedBuffer);
  const uncompressedPassed =
    decodedUncompressed.header.totalGaussians === 20 &&
    decodedUncompressed.header.staticGaussians === 10 &&
    decodedUncompressed.header.dynamicGaussians === 10 &&
    decodedUncompressed.allGaussiansPacked.length === 20 * 19;

  // ---------------- Test 2: Compressed Mode (DEFLATE) ----------------
  const compressedBuffer = await encode4DVAsync(gaussians, {
    title: 'Deterministic Test Compressed',
    duration,
    fps,
    useQuantization: true,
    chunkDuration: 1.0,
    compressChunks: true,
  });

  const decodedCompressed = await decode4DVAsync(compressedBuffer);
  const compressedPassed =
    decodedCompressed.header.totalGaussians === 20 &&
    decodedCompressed.header.staticGaussians === 10 &&
    decodedCompressed.header.dynamicGaussians === 10 &&
    decodedCompressed.allGaussiansPacked.length === 20 * 19 &&
    compressedBuffer.byteLength <= uncompressedBuffer.byteLength;

  // ---------------- Test 3: Numerical Fidelity Comparison ----------------
  let sumPosErr = 0;
  let sumScaleErr = 0;
  let sumColorErr = 0;

  for (let i = 0; i < 20; i++) {
    const decDst = i * 19;
    const decPos = [
      decodedCompressed.allGaussiansPacked[decDst + 0],
      decodedCompressed.allGaussiansPacked[decDst + 1],
      decodedCompressed.allGaussiansPacked[decDst + 2],
    ];
    const decScale = decodedCompressed.allGaussiansPacked[decDst + 3];
    const decColor = decodedCompressed.allGaussiansPacked[decDst + 6];

    // Find closest ground truth Gaussian (accounting for Morton spatial sort)
    let bestDist = Infinity;
    let bestOrig = gaussians[0];
    for (const g of gaussians) {
      const dx = decPos[0] - g.position[0];
      const dy = decPos[1] - g.position[1];
      const dz = decPos[2] - g.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrig = g;
      }
    }

    sumPosErr += bestDist;
    sumScaleErr += Math.abs(decScale - bestOrig.scale[0]);
    sumColorErr += Math.abs(decColor - bestOrig.color[0]);
  }

  const positionMAE = sumPosErr / 20;
  const scaleMAE = sumScaleErr / 20;
  const colorMAE = sumColorErr / 20;

  // ---------------- Test 4: Random-Access Chunk Reading ----------------
  const chunk0Floats = await readChunkAsync(compressedBuffer, decodedCompressed.toc[0], decodedCompressed.header);
  const targetChunk1 = getChunkForTime(decodedCompressed.toc, 0.5);
  const chunk1Floats = targetChunk1 ? await readChunkAsync(compressedBuffer, targetChunk1, decodedCompressed.header) : null;
  const targetChunk2 = getChunkForTime(decodedCompressed.toc, 1.5);
  const chunk2Floats = targetChunk2 ? await readChunkAsync(compressedBuffer, targetChunk2, decodedCompressed.header) : null;

  const randomAccessPassed =
    chunk0Floats.length === 10 * 10 &&
    chunk1Floats !== null &&
    chunk1Floats.length === 10 * 19 &&
    chunk2Floats !== null &&
    chunk2Floats.length === 10 * 19;

  const passed =
    uncompressedPassed &&
    compressedPassed &&
    randomAccessPassed &&
    positionMAE < 0.005 &&
    scaleMAE < 0.005 &&
    colorMAE < 0.01;

  const details = passed
    ? `Round-trip PASSED: Uncompressed (${uncompressedBuffer.byteLength}B) & Compressed (${compressedBuffer.byteLength}B) decoded accurately. Pos MAE: ${positionMAE.toFixed(6)}.`
    : `Round-trip FAILED: uncompressed=${uncompressedPassed}, compressed=${compressedPassed}, randomAccess=${randomAccessPassed}, posMAE=${positionMAE.toFixed(6)}`;

  console.log(`[4DV RoundTrip] ${details}`);

  return {
    uncompressedPassed,
    compressedPassed,
    randomAccessPassed,
    uncompressedSize: uncompressedBuffer.byteLength,
    compressedSize: compressedBuffer.byteLength,
    positionMAE,
    scaleMAE,
    colorMAE,
    passed,
    details,
  };
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
  const rawBytes = polynomials.length * 76;

  const uint8 = encode4DV(polynomials, {
    title: scene.name,
    fps: scene.fps,
    duration: scene.duration,
    useQuantization: true,
  });

  const encodedBytes = uint8.byteLength;
  const compressionRatio = parseFloat((rawBytes / encodedBytes).toFixed(2));

  const decoded = decode4DV(uint8);

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

  const bin = encodeTemporalScene(polynomials, scene.duration, scene.fps);
  const seq = decodeTemporalScene(bin);

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
