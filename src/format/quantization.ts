import { Gaussian4DPolynomial } from '../renderer/types';
import { getMortonKey } from './morton';

export interface QuantizationSettings {
  positionBits: 16;
  colorBits: 8;
  opacityBits: 8;
  scaleBits: 16;
}

export interface QuantizedGaussianRecord {
  quantizedPos: [number, number, number];   // uint16 [0..65535]
  quantizedScale: [number, number, number]; // uint16 [0..65535]
  quantizedColor: [number, number, number]; // uint8  [0..255]
  quantizedOpacity: number;                 // uint8  [0..255]
  mortonKey: number;

  isDynamic: boolean;
  quantizedVelocity?: [number, number, number]; // int16
  quantizedHarmonic?: [number, number, number]; // uint16
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

/**
 * Computes bounding box of all Gaussian centers.
 */
export function computeSceneBounds(gaussians: Gaussian4DPolynomial[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  if (gaussians.length === 0) {
    return { min: [-1, -1, -1], max: [1, 1, 1] };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const g of gaussians) {
    const [x, y, z] = g.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX - 0.1, minY - 0.1, minZ - 0.1],
    max: [maxX + 0.1, maxY + 0.1, maxZ + 0.1],
  };
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

  // 2. Compute 3D scene bounds
  const bounds = computeSceneBounds(validGaussians);
  const dx = Math.max(bounds.max[0] - bounds.min[0], 0.0001);
  const dy = Math.max(bounds.max[1] - bounds.min[1], 0.0001);
  const dz = Math.max(bounds.max[2] - bounds.min[2], 0.0001);

  // 3. Quantize and assign Morton keys
  const records: QuantizedGaussianRecord[] = [];

  for (const g of validGaussians) {
    // 16-bit Normalized Position [0..65535]
    const qx = Math.round(((g.position[0] - bounds.min[0]) / dx) * 65535);
    const qy = Math.round(((g.position[1] - bounds.min[1]) / dy) * 65535);
    const qz = Math.round(((g.position[2] - bounds.min[2]) / dz) * 65535);

    // 16-bit Scale
    const qsx = Math.round(Math.min(g.scale[0] * 10000, 65535));
    const qsy = Math.round(Math.min(g.scale[1] * 10000, 65535));
    const qsz = Math.round(Math.min(g.scale[2] * 10000, 65535));

    // 8-bit Color [0..255]
    const qr = Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255);
    const qg = Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255);
    const qb = Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255);

    // 8-bit Opacity [0..255]
    const qOp = Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255);

    // Compute Morton Key for spatial sorting
    const morton = getMortonKey(g.position, bounds.min, bounds.max);

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
          Math.round(g.motionP1[0] * 1000),
          Math.round(g.motionP1[1] * 1000),
          Math.round(g.motionP1[2] * 1000),
        ];
      }
      if (g.motionP3) {
        record.quantizedHarmonic = [
          Math.round(g.motionP3[0] * 1000),
          Math.round(g.motionP3[1] * 1000),
          Math.round(g.motionP3[2] * 1000),
        ];
      }
    }

    records.push(record);
  }

  // 4. Spatial Morton Sort
  records.sort((a, b) => a.mortonKey - b.mortonKey);

  // 5. Memory footprint calculations:
  // Raw Float32: totalCount * 76 bytes (19 floats)
  // Quantized:
  // Static record: 3*2B (pos) + 3*2B (scale) + 3*1B (color) + 1*1B (op) = 16 bytes
  // Dynamic record: 16B + 3*2B (vel) + 3*2B (harmonic) = 28 bytes
  const rawBytes = totalCount * 76;
  let quantizedTotalBytes = 0;
  for (const r of records) {
    quantizedTotalBytes += r.isDynamic ? 28 : 16;
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
    boundsMin: bounds.min,
    boundsMax: bounds.max,
  };

  return { quantizedRecords: records, report };
}
