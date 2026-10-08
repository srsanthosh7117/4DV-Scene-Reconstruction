import { Gaussian3D } from '../renderer/types';

/**
 * Generates a recognizable procedural 3D Gaussian test scene for Phase 2 validation.
 * Creates a structured 3D dual-ring torus with volumetric center cluster and color gradients.
 */
export function generateProceduralGaussianScene(count: number = 600): Gaussian3D[] {
  const gaussians: Gaussian3D[] = [];

  // 1. Central glowing core cluster (100 Gaussians)
  const coreCount = Math.floor(count * 0.2);
  for (let i = 0; i < coreCount; i++) {
    const theta = Math.random() * 2 * Math.PI;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.5) * 0.4;

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    // Warm golden-cyan gradient
    gaussians.push({
      position: [x, y, z],
      scale: [0.06, 0.06, 0.06],
      color: [1.0, 0.75 + Math.random() * 0.2, 0.3],
      opacity: 0.85,
    });
  }

  // 2. Outer 3D Torus Structure (80% of remaining count)
  const torusCount = count - coreCount;
  const majorRadius = 1.6;
  const minorRadius = 0.55;

  for (let i = 0; i < torusCount; i++) {
    const u = (i / torusCount) * Math.PI * 8; // Multiple spirals around torus
    const v = (i / torusCount) * 2 * Math.PI;

    // Torus coordinates with slight Gaussian jitter
    const jitter = () => (Math.random() - 0.5) * 0.08;
    const x = (majorRadius + minorRadius * Math.cos(u)) * Math.cos(v) + jitter();
    const y = minorRadius * Math.sin(u) + jitter();
    const z = (majorRadius + minorRadius * Math.cos(u)) * Math.sin(v) + jitter();

    // Vibrant spectral color map across azimuth angle v
    const normAngle = (v / (2 * Math.PI)) % 1.0;
    const r = 0.5 + 0.5 * Math.sin(normAngle * 2 * Math.PI);
    const g = 0.5 + 0.5 * Math.sin(normAngle * 2 * Math.PI + (2 * Math.PI) / 3);
    const b = 0.5 + 0.5 * Math.sin(normAngle * 2 * Math.PI + (4 * Math.PI) / 3);

    // Varied scales to test splat sizes
    const baseScale = 0.045 + Math.sin(u * 2) * 0.015;

    gaussians.push({
      position: [x, y, z],
      scale: [baseScale, baseScale, baseScale],
      color: [r, g, b],
      opacity: 0.75,
    });
  }

  return gaussians;
}
