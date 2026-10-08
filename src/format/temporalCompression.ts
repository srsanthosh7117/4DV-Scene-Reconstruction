import { Gaussian4DPolynomial } from '../renderer/types';

/**
 * Compressed temporal representation with base keyframe and sparse deltas.
 */
export interface CompressedTemporalGaussian {
  id: number;
  basePosition: [number, number, number];
  baseScale: [number, number, number];
  baseColor: [number, number, number];
  baseOpacity: number;
  isDynamic: boolean;

  // Discrete delta samples across keyframes
  deltaPositions?: Float32Array; // Interleaved [dx0, dy0, dz0, dx1, dy1, dz1, ...]
  deltaScales?: Float32Array;
  deltaColors?: Float32Array;
  deltaOpacities?: Float32Array;
}

export interface CompressedTemporalSequence {
  frameCount: number;
  fps: number;
  duration: number;
  timestamps: Float32Array;
  gaussians: CompressedTemporalGaussian[];
}

export interface ReconstructionMetrics {
  maxPositionError: number;
  meanPositionError: number;
  maxColorError: number;
  meanColorError: number;
  testedSamples: number;
}

/**
 * Encodes a set of 4D polynomial Gaussians into a temporal base + delta stream.
 */
export function encodeTemporalDeltas(
  gaussians: Gaussian4DPolynomial[],
  duration: number = 5.0,
  fps: number = 30
): CompressedTemporalSequence {
  const frameCount = Math.floor(duration * fps);
  const timestamps = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    timestamps[f] = f / fps;
  }

  const encodedList: CompressedTemporalGaussian[] = [];

  for (let i = 0; i < gaussians.length; i++) {
    const g = gaussians[i];
    const isDynamic = g.motionDegree > 0;

    const basePos: [number, number, number] = [...g.position];
    const baseScale: [number, number, number] = [...g.scale];
    const baseCol: [number, number, number] = [...g.color];
    const baseOp = g.opacity;

    if (!isDynamic) {
      // Static Gaussian: No deltas needed
      encodedList.push({
        id: i,
        basePosition: basePos,
        baseScale: baseScale,
        baseColor: baseCol,
        baseOpacity: baseOp,
        isDynamic: false,
      });
    } else {
      // Dynamic Gaussian: Sample discrete temporal deltas
      const deltaPos = new Float32Array(frameCount * 3);
      const deltaScale = new Float32Array(frameCount * 3);
      const deltaCol = new Float32Array(frameCount * 3);
      const deltaOp = new Float32Array(frameCount);

      for (let f = 0; f < frameCount; f++) {
        const t = timestamps[f];
        const t2 = t * t;

        // True position at time t
        let px = basePos[0] + (g.motionP1 ? g.motionP1[0] * t : 0) + (g.motionP2 ? g.motionP2[0] * t2 : 0);
        let py = basePos[1] + (g.motionP1 ? g.motionP1[1] * t : 0) + (g.motionP2 ? g.motionP2[1] * t2 : 0);
        let pz = basePos[2] + (g.motionP1 ? g.motionP1[2] * t : 0) + (g.motionP2 ? g.motionP2[2] * t2 : 0);

        if (g.motionP3 && g.motionP3[0] > 0) {
          const amp = g.motionP3[0];
          const freq = g.motionP3[1];
          const phase = g.motionP3[2];
          py += amp * Math.sin(freq * t + phase);
          px += (amp * 0.5) * Math.cos(freq * t + phase);
        }

        // Delta = P(t) - P_base
        deltaPos[f * 3 + 0] = px - basePos[0];
        deltaPos[f * 3 + 1] = py - basePos[1];
        deltaPos[f * 3 + 2] = pz - basePos[2];

        // Scales & Colors deltas
        deltaScale[f * 3 + 0] = 0;
        deltaScale[f * 3 + 1] = 0;
        deltaScale[f * 3 + 2] = 0;

        deltaCol[f * 3 + 0] = 0;
        deltaCol[f * 3 + 1] = 0;
        deltaCol[f * 3 + 2] = 0;

        deltaOp[f] = 0;
      }

      encodedList.push({
        id: i,
        basePosition: basePos,
        baseScale: baseScale,
        baseColor: baseCol,
        baseOpacity: baseOp,
        isDynamic: true,
        deltaPositions: deltaPos,
        deltaScales: deltaScale,
        deltaColors: deltaCol,
        deltaOpacities: deltaOp,
      });
    }
  }

  return {
    frameCount,
    fps,
    duration,
    timestamps,
    gaussians: encodedList,
  };
}

/**
 * Reconstructs Gaussian positions at arbitrary time t with sub-frame interpolation.
 */
export function decodeTemporalState(
  sequence: CompressedTemporalSequence,
  time: number
): Float32Array {
  const count = sequence.gaussians.length;
  const outPositions = new Float32Array(count * 3);

  const clampedTime = Math.max(0, Math.min(sequence.duration, time));
  const rawFrame = clampedTime * sequence.fps;
  const frame0 = Math.min(Math.floor(rawFrame), sequence.frameCount - 1);
  const frame1 = Math.min(frame0 + 1, sequence.frameCount - 1);
  const alpha = rawFrame - Math.floor(rawFrame); // Sub-frame interpolation fraction

  for (let i = 0; i < count; i++) {
    const g = sequence.gaussians[i];
    const baseOffset = i * 3;

    if (!g.isDynamic || !g.deltaPositions) {
      outPositions[baseOffset + 0] = g.basePosition[0];
      outPositions[baseOffset + 1] = g.basePosition[1];
      outPositions[baseOffset + 2] = g.basePosition[2];
    } else {
      // Linear interpolation between frame0 and frame1 deltas
      const dx0 = g.deltaPositions[frame0 * 3 + 0];
      const dy0 = g.deltaPositions[frame0 * 3 + 1];
      const dz0 = g.deltaPositions[frame0 * 3 + 2];

      const dx1 = g.deltaPositions[frame1 * 3 + 0];
      const dy1 = g.deltaPositions[frame1 * 3 + 1];
      const dz1 = g.deltaPositions[frame1 * 3 + 2];

      const dx = dx0 + (dx1 - dx0) * alpha;
      const dy = dy0 + (dy1 - dy0) * alpha;
      const dz = dz0 + (dz1 - dz0) * alpha;

      outPositions[baseOffset + 0] = g.basePosition[0] + dx;
      outPositions[baseOffset + 1] = g.basePosition[1] + dy;
      outPositions[baseOffset + 2] = g.basePosition[2] + dz;
    }
  }

  return outPositions;
}

/**
 * Serializes compressed temporal sequence into binary payload.
 */
export function encodeTemporalScene(
  gaussians: Gaussian4DPolynomial[],
  duration: number = 5.0,
  fps: number = 30
): Uint8Array {
  const seq = encodeTemporalDeltas(gaussians, duration, fps);
  const totalGaussians = seq.gaussians.length;
  const frameCount = seq.frameCount;

  // Base attributes: totalGaussians * (3 pos + 3 scale + 3 col + 1 op) * 4B = 40B/elem
  let dynamicCount = 0;
  for (const g of seq.gaussians) {
    if (g.isDynamic) dynamicCount++;
  }

  // Header: 16B (totalGaussians, dynamicCount, frameCount, fps)
  const headerSize = 16;
  const baseSize = totalGaussians * 40;
  const deltaSize = dynamicCount * (frameCount * 3 * 4); // deltaPositions
  const totalSize = headerSize + baseSize + deltaSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  view.setUint32(0, totalGaussians, true);
  view.setUint32(4, dynamicCount, true);
  view.setUint32(8, frameCount, true);
  view.setFloat32(12, fps, true);

  let offset = headerSize;
  // Write base attributes
  for (let i = 0; i < totalGaussians; i++) {
    const g = seq.gaussians[i];
    view.setFloat32(offset + 0, g.basePosition[0], true);
    view.setFloat32(offset + 4, g.basePosition[1], true);
    view.setFloat32(offset + 8, g.basePosition[2], true);
    view.setFloat32(offset + 12, g.baseScale[0], true);
    view.setFloat32(offset + 16, g.baseScale[1], true);
    view.setFloat32(offset + 20, g.baseScale[2], true);
    view.setFloat32(offset + 24, g.baseColor[0], true);
    view.setFloat32(offset + 28, g.baseColor[1], true);
    view.setFloat32(offset + 32, g.baseColor[2], true);
    view.setFloat32(offset + 36, g.baseOpacity, true);
    offset += 40;
  }

  // Write dynamic delta streams
  for (let i = 0; i < totalGaussians; i++) {
    const g = seq.gaussians[i];
    if (g.isDynamic && g.deltaPositions) {
      for (let k = 0; k < g.deltaPositions.length; k++) {
        view.setFloat32(offset, g.deltaPositions[k], true);
        offset += 4;
      }
    }
  }

  return out;
}

/**
 * Deserializes binary temporal scene payload into CompressedTemporalSequence.
 */
export function decodeTemporalScene(buffer: ArrayBuffer | Uint8Array): CompressedTemporalSequence {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const view = new DataView(arrayBuffer, byteOffset);

  const totalGaussians = view.getUint32(0, true);
  const dynamicCount = view.getUint32(4, true);
  const frameCount = view.getUint32(8, true);
  const fps = view.getFloat32(12, true);
  const duration = frameCount / fps;

  const timestamps = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    timestamps[f] = f / fps;
  }

  const gaussians: CompressedTemporalGaussian[] = [];
  let offset = 16;

  // Read base
  for (let i = 0; i < totalGaussians; i++) {
    const bp: [number, number, number] = [
      view.getFloat32(offset + 0, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    const bs: [number, number, number] = [
      view.getFloat32(offset + 12, true),
      view.getFloat32(offset + 16, true),
      view.getFloat32(offset + 20, true),
    ];
    const bc: [number, number, number] = [
      view.getFloat32(offset + 24, true),
      view.getFloat32(offset + 28, true),
      view.getFloat32(offset + 32, true),
    ];
    const bo = view.getFloat32(offset + 36, true);
    offset += 40;

    gaussians.push({
      id: i,
      basePosition: bp,
      baseScale: bs,
      baseColor: bc,
      baseOpacity: bo,
      isDynamic: false,
    });
  }

  // Read deltas for dynamic elements (first N or classified elements)
  const dynamicStride = frameCount * 3;
  let dynamicProcessed = 0;
  for (let i = 0; i < totalGaussians && dynamicProcessed < dynamicCount; i++) {
    // If element is dynamic (after static split)
    if (i >= totalGaussians - dynamicCount) {
      gaussians[i].isDynamic = true;
      const deltaPos = new Float32Array(dynamicStride);
      for (let k = 0; k < dynamicStride; k++) {
        deltaPos[k] = view.getFloat32(offset, true);
        offset += 4;
      }
      gaussians[i].deltaPositions = deltaPos;
      dynamicProcessed++;
    }
  }

  return {
    frameCount,
    fps,
    duration,
    timestamps,
    gaussians,
  };
}

/**
 * Evaluates numerical reconstruction error between original analytical state and decoded delta state.
 */
export function evaluateReconstructionAccuracy(
  originalGaussians: Gaussian4DPolynomial[],
  sequence: CompressedTemporalSequence,
  testTimestamps: number[] = [0.0, 1.25, 2.5, 3.75, 5.0]
): ReconstructionMetrics {
  let maxPosErr = 0;
  let sumPosErr = 0;
  let sampleCount = 0;

  for (const t of testTimestamps) {
    const decodedPositions = decodeTemporalState(sequence, t);

    for (let i = 0; i < originalGaussians.length; i++) {
      const g = originalGaussians[i];
      const t2 = t * t;

      let trueX = g.position[0] + (g.motionP1 ? g.motionP1[0] * t : 0) + (g.motionP2 ? g.motionP2[0] * t2 : 0);
      let trueY = g.position[1] + (g.motionP1 ? g.motionP1[1] * t : 0) + (g.motionP2 ? g.motionP2[1] * t2 : 0);
      let trueZ = g.position[2] + (g.motionP1 ? g.motionP1[2] * t : 0) + (g.motionP2 ? g.motionP2[2] * t2 : 0);

      if (g.motionP3 && g.motionP3[0] > 0) {
        const amp = g.motionP3[0];
        const freq = g.motionP3[1];
        const phase = g.motionP3[2];
        trueY += amp * Math.sin(freq * t + phase);
        trueX += (amp * 0.5) * Math.cos(freq * t + phase);
      }

      const decX = decodedPositions[i * 3 + 0];
      const decY = decodedPositions[i * 3 + 1];
      const decZ = decodedPositions[i * 3 + 2];

      const err = Math.hypot(trueX - decX, trueY - decY, trueZ - decZ);
      if (err > maxPosErr) maxPosErr = err;
      sumPosErr += err;
      sampleCount++;
    }
  }

  return {
    maxPositionError: parseFloat(maxPosErr.toExponential(3)),
    meanPositionError: parseFloat((sumPosErr / Math.max(sampleCount, 1)).toExponential(3)),
    maxColorError: 0,
    meanColorError: 0,
    testedSamples: sampleCount,
  };
}
