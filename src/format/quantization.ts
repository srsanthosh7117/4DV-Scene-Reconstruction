import { Gaussian4DPolynomial } from '../renderer/types';
import { getMortonKey } from './morton';
import { FourDVRanges } from './fourdvSchema';

export interface QuantizationSettings {
  positionBits: 16;
  colorBits: 8;
  opacityBits: 8;
  scaleBits: 16;
  velocityBits: 16;
}

export interface QuantizedGaussianRecord {
  quantizedPos: [number, number, number];   // uint16 [0..65535]
  quantizedScale: [number, number, number]; // uint16 [0..65535]
  quantizedColor: [number, number, number]; // uint8  [0..255]
  quantizedOpacity: number;                 // uint8  [0..255]
  mortonKey: number;

  isDynamic: boolean;
  quantizedVelocity?: [number, number, number]; // int16 [-32768..32767]
  quantizedAccel?: [number, number, number];    // int16 [-32768..32767]
  quantizedHarmonic?: [number, number, number]; // uint16 [0..65535]
}

export interface QuantizationReport {
  originalGaussianCount: number;
  prunedGaussianCount: number;
  remainingGaussianCount: number;
  rawFloat32Bytes: number;
  quantizedBytes: number;
  compressionRatio: number;
  spaceSavingsPercent: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface QuantizationAccuracyMetrics {
  positionMAE: number;
  positionMaxError: number;
  positionRMSE: number;
  scaleMAE: number;
  scaleMaxError: number;
  colorMAE: number;
  colorMaxError: number;
  opacityMAE: number;
  opacityMaxError: number;
  velocityMAE: number;
  velocityMaxError: number;
  testedCount: number;
  passed: boolean;
}

/**
 * Computes bounding box and max ranges for normalizations.
 */
export function computeSceneRanges(gaussians: Gaussian4DPolynomial[]): FourDVRanges {
  if (gaussians.length === 0) {
    return {
      boundsMin: [-1, -1, -1],
      boundsMax: [1, 1, 1],
      scaleMax: 1.0,
      velMax: 1.0,
      accelMax: 1.0,
      harmonicMax: [1.0, 1.0, Math.PI * 2],
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let maxScale = 0.001;
  let maxVel = 0.001;
  let maxAccel = 0.001;
  let maxAmp = 0.001;
  let maxFreq = 0.001;

  for (const g of gaussians) {
    const [x, y, z] = g.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;

    const sMax = Math.max(g.scale[0], g.scale[1], g.scale[2]);
    if (sMax > maxScale) maxScale = sMax;

    if (g.motionP1) {
      const vMax = Math.max(Math.abs(g.motionP1[0]), Math.abs(g.motionP1[1]), Math.abs(g.motionP1[2]));
      if (vMax > maxVel) maxVel = vMax;
    }
    if (g.motionP2) {
      const aMax = Math.max(Math.abs(g.motionP2[0]), Math.abs(g.motionP2[1]), Math.abs(g.motionP2[2]));
      if (aMax > maxAccel) maxAccel = aMax;
    }
    if (g.motionP3) {
      if (g.motionP3[0] > maxAmp) maxAmp = g.motionP3[0];
      if (g.motionP3[1] > maxFreq) maxFreq = g.motionP3[1];
    }
  }

  return {
    boundsMin: [minX - 0.05, minY - 0.05, minZ - 0.05],
    boundsMax: [maxX + 0.05, maxY + 0.05, maxZ + 0.05],
    scaleMax: maxScale * 1.05,
    velMax: maxVel * 1.05,
    accelMax: maxAccel * 1.05,
    harmonicMax: [maxAmp * 1.05, maxFreq * 1.05, Math.PI * 2],
  };
}

/**
 * Computes bounding box of all Gaussian centers.
 */
export function computeSceneBounds(gaussians: Gaussian4DPolynomial[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const ranges = computeSceneRanges(gaussians);
  return { min: ranges.boundsMin, max: ranges.boundsMax };
}

/**
 * Prunes, sorts by 3D Morton code, and quantizes 4D Gaussians.
 */
export function quantizeAndOrderGaussians(
  gaussians: Gaussian4DPolynomial[],
  pruneOpacityThreshold: number = 0.05,
  pruneMinScale: number = 0.005
): {
  quantizedRecords: QuantizedGaussianRecord[];
  report: QuantizationReport;
} {
  const totalCount = gaussians.length;

  // 1. Pruning pass
  const validGaussians: Gaussian4DPolynomial[] = [];
  for (const g of gaussians) {
    const maxScale = Math.max(g.scale[0], g.scale[1], g.scale[2]);
    if (g.opacity >= pruneOpacityThreshold && maxScale >= pruneMinScale) {
      validGaussians.push(g);
    }
  }

  const prunedCount = totalCount - validGaussians.length;
  const remainingCount = validGaussians.length;

  // 2. Compute ranges
  const ranges = computeSceneRanges(validGaussians);
  const dx = Math.max(ranges.boundsMax[0] - ranges.boundsMin[0], 0.0001);
  const dy = Math.max(ranges.boundsMax[1] - ranges.boundsMin[1], 0.0001);
  const dz = Math.max(ranges.boundsMax[2] - ranges.boundsMin[2], 0.0001);
  const sMax = Math.max(ranges.scaleMax, 0.0001);
  const vMax = Math.max(ranges.velMax, 0.0001);
  const aMax = Math.max(ranges.accelMax, 0.0001);

  // 3. Quantize and assign Morton keys
  const records: QuantizedGaussianRecord[] = [];

  for (const g of validGaussians) {
    // 16-bit Normalized Position [0..65535]
    const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
    const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
    const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);

    // 16-bit Scale [0..65535]
    const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
    const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
    const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);

    // 8-bit Color [0..255]
    const qr = Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255);
    const qg = Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255);
    const qb = Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255);

    // 8-bit Opacity [0..255]
    const qOp = Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255);

    // Compute Morton Key for spatial sorting
    const morton = getMortonKey(g.position, ranges.boundsMin, ranges.boundsMax);

    const isDynamic = g.motionDegree > 0;
    const record: QuantizedGaussianRecord = {
      quantizedPos: [qx, qy, qz],
      quantizedScale: [qsx, qsy, qsz],
      quantizedColor: [qr, qg, qb],
      quantizedOpacity: qOp,
      mortonKey: morton,
      isDynamic,
    };

    if (isDynamic) {
      if (g.motionP1) {
        record.quantizedVelocity = [
          Math.round(Math.min(Math.max(g.motionP1[0] / vMax, -1), 1) * 32767),
          Math.round(Math.min(Math.max(g.motionP1[1] / vMax, -1), 1) * 32767),
          Math.round(Math.min(Math.max(g.motionP1[2] / vMax, -1), 1) * 32767),
        ];
      }
      if (g.motionP2) {
        record.quantizedAccel = [
          Math.round(Math.min(Math.max(g.motionP2[0] / aMax, -1), 1) * 32767),
          Math.round(Math.min(Math.max(g.motionP2[1] / aMax, -1), 1) * 32767),
          Math.round(Math.min(Math.max(g.motionP2[2] / aMax, -1), 1) * 32767),
        ];
      }
      if (g.motionP3) {
        record.quantizedHarmonic = [
          Math.round(Math.min(Math.max(g.motionP3[0] / ranges.harmonicMax[0], 0), 1) * 65535),
          Math.round(Math.min(Math.max(g.motionP3[1] / ranges.harmonicMax[1], 0), 1) * 65535),
          Math.round(Math.min(Math.max(g.motionP3[2] / ranges.harmonicMax[2], 0), 1) * 65535),
        ];
      }
    }

    records.push(record);
  }

  // 4. Spatial Morton Sort
  records.sort((a, b) => a.mortonKey - b.mortonKey);

  // 5. Memory footprint calculations:
  // Static record: 16B | Dynamic record: 34B
  const rawBytes = totalCount * 76;
  let quantizedTotalBytes = 0;
  for (const r of records) {
    quantizedTotalBytes += r.isDynamic ? 34 : 16;
  }

  const compressionRatio = rawBytes / Math.max(quantizedTotalBytes, 1);
  const spaceSavings = ((rawBytes - quantizedTotalBytes) / rawBytes) * 100;

  const report: QuantizationReport = {
    originalGaussianCount: totalCount,
    prunedGaussianCount: prunedCount,
    remainingGaussianCount: remainingCount,
    rawFloat32Bytes: rawBytes,
    quantizedBytes: quantizedTotalBytes,
    compressionRatio: parseFloat(compressionRatio.toFixed(2)),
    spaceSavingsPercent: parseFloat(spaceSavings.toFixed(2)),
    boundsMin: ranges.boundsMin,
    boundsMax: ranges.boundsMax,
  };

  return { quantizedRecords: records, report };
}

/**
 * Numerically compares original Float32 Gaussians vs reconstructed dequantized Float32 Gaussians.
 */
export function evaluateQuantizationAccuracy(
  original: Gaussian4DPolynomial[],
  reconstructed: Float32Array, // Interleaved 19-float stride
  count: number
): QuantizationAccuracyMetrics {
  let posErrorSum = 0;
  let posMaxError = 0;
  let posSqErrorSum = 0;

  let scaleErrorSum = 0;
  let scaleMaxError = 0;

  let colErrorSum = 0;
  let colMaxError = 0;

  let opErrorSum = 0;
  let opMaxError = 0;

  let velErrorSum = 0;
  let velMaxError = 0;

  const testCount = Math.min(original.length, count);

  for (let i = 0; i < testCount; i++) {
    const orig = original[i];
    const dst = i * 19;

    // Position error
    const dx = Math.abs(orig.position[0] - reconstructed[dst + 0]);
    const dy = Math.abs(orig.position[1] - reconstructed[dst + 1]);
    const dz = Math.abs(orig.position[2] - reconstructed[dst + 2]);
    const posDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    posErrorSum += posDist;
    posSqErrorSum += posDist * posDist;
    if (posDist > posMaxError) posMaxError = posDist;

    // Scale error
    const dsx = Math.abs(orig.scale[0] - reconstructed[dst + 3]);
    const dsy = Math.abs(orig.scale[1] - reconstructed[dst + 4]);
    const dsz = Math.abs(orig.scale[2] - reconstructed[dst + 5]);
    const scaleErr = (dsx + dsy + dsz) / 3;
    scaleErrorSum += scaleErr;
    if (scaleErr > scaleMaxError) scaleMaxError = scaleErr;

    // Color error
    const dcr = Math.abs(orig.color[0] - reconstructed[dst + 6]);
    const dcg = Math.abs(orig.color[1] - reconstructed[dst + 7]);
    const dcb = Math.abs(orig.color[2] - reconstructed[dst + 8]);
    const colErr = (dcr + dcg + dcb) / 3;
    colErrorSum += colErr;
    if (colErr > colMaxError) colMaxError = colErr;

    // Opacity error
    const dop = Math.abs(orig.opacity - reconstructed[dst + 9]);
    opErrorSum += dop;
    if (dop > opMaxError) opMaxError = dop;

    // Velocity error (if dynamic)
    if (orig.motionP1) {
      const dvx = Math.abs(orig.motionP1[0] - reconstructed[dst + 10]);
      const dvy = Math.abs(orig.motionP1[1] - reconstructed[dst + 11]);
      const dvz = Math.abs(orig.motionP1[2] - reconstructed[dst + 12]);
      const velDist = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
      velErrorSum += velDist;
      if (velDist > velMaxError) velMaxError = velDist;
    }
  }

  const n = Math.max(testCount, 1);
  const positionMAE = posErrorSum / n;
  const positionRMSE = Math.sqrt(posSqErrorSum / n);
  const scaleMAE = scaleErrorSum / n;
  const colorMAE = colErrorSum / n;
  const opacityMAE = opErrorSum / n;
  const velocityMAE = velErrorSum / n;

  // Sub-millimeter position tolerance (< 0.005 units)
  const passed = posMaxError < 0.005;

  return {
    positionMAE: parseFloat(positionMAE.toFixed(6)),
    positionMaxError: parseFloat(posMaxError.toFixed(6)),
    positionRMSE: parseFloat(positionRMSE.toFixed(6)),
    scaleMAE: parseFloat(scaleMAE.toFixed(6)),
    scaleMaxError: parseFloat(scaleMaxError.toFixed(6)),
    colorMAE: parseFloat(colorMAE.toFixed(6)),
    colorMaxError: parseFloat(colMaxError.toFixed(6)),
    opacityMAE: parseFloat(opacityMAE.toFixed(6)),
    opacityMaxError: parseFloat(opMaxError.toFixed(6)),
    velocityMAE: parseFloat(velocityMAE.toFixed(6)),
    velocityMaxError: parseFloat(velMaxError.toFixed(6)),
    testedCount: testCount,
    passed,
  };
}
