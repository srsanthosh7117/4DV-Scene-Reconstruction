import { Gaussian4DPolynomial } from '../renderer/types';
import { SeparatedSceneData, SeparationStats } from './types';

/**
 * Computes motion energy metric for a Gaussian:
 * E = ||P1||^2 + ||P2||^2 + Amplitude^2
 */
export function computeGaussianMotionEnergy(g: Gaussian4DPolynomial): number {
  if (g.motionDegree === 0) return 0;

  let energy = 0;

  // Linear velocity contribution
  if (g.motionP1) {
    const [vx, vy, vz] = g.motionP1;
    energy += vx * vx + vy * vy + vz * vz;
  }

  // Acceleration contribution
  if (g.motionP2) {
    const [ax, ay, az] = g.motionP2;
    energy += (ax * ax + ay * ay + az * az) * 2.0;
  }

  // Harmonic oscillation amplitude
  if (g.motionP3 && g.motionP3[0] > 0) {
    const amp = g.motionP3[0];
    energy += amp * amp;
  }

  return energy;
}

/**
 * Separates a 4D Gaussian scene into STATIC and DYNAMIC subsets based on motion threshold.
 * Static Gaussians only require base 3D attributes (10 floats = 40B).
 * Dynamic Gaussians require 4D temporal coefficients (19 floats = 76B).
 */
export function separateStaticDynamicGaussians(
  gaussians: Gaussian4DPolynomial[],
  threshold: number = 0.0001
): SeparatedSceneData {
  const staticList: Gaussian4DPolynomial[] = [];
  const dynamicList: Gaussian4DPolynomial[] = [];

  for (let i = 0; i < gaussians.length; i++) {
    const g = gaussians[i];
    const energy = computeGaussianMotionEnergy(g);

    if (energy <= threshold) {
      // Static: Zero out temporal terms to ensure zero divergence
      staticList.push({
        ...g,
        motionDegree: 0,
        motionP1: [0, 0, 0],
        motionP2: [0, 0, 0],
        motionP3: [0, 0, 0],
      });
    } else {
      dynamicList.push(g);
    }
  }

  const total = gaussians.length;
  const staticCount = staticList.length;
  const dynamicCount = dynamicList.length;

  // Memory calculations:
  // Unseparated raw 4D stream: total * 76 bytes
  // Separated stream: static * 40 bytes + dynamic * 76 bytes
  const staticMemoryBytes = staticCount * 40;
  const dynamicMemoryBytes = dynamicCount * 76;
  const uncompressedTotalBytes = total * 76;
  const separatedTotalBytes = staticMemoryBytes + dynamicMemoryBytes;
  const savedBytes = uncompressedTotalBytes - separatedTotalBytes;
  const bandwidthSavedPercent = total > 0 ? (savedBytes / uncompressedTotalBytes) * 100 : 0;

  const stats: SeparationStats = {
    totalCount: total,
    staticCount,
    dynamicCount,
    staticRatio: total > 0 ? staticCount / total : 0,
    dynamicRatio: total > 0 ? dynamicCount / total : 0,
    threshold,
    staticMemoryBytes,
    dynamicMemoryBytes,
    uncompressedTotalBytes,
    separatedTotalBytes,
    bandwidthSavedPercent: parseFloat(bandwidthSavedPercent.toFixed(2)),
  };

  return {
    staticGaussians: staticList,
    dynamicGaussians: dynamicList,
    stats,
  };
}
