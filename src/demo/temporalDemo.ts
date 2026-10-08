import { Gaussian4DPolynomial, TemporalScene4D, TemporalKeyframe } from '../renderer/types';

/**
 * Generates a rich procedural 4D temporal Gaussian scene for Phase 4 validation.
 * Contains static landmarks (motionDegree = 0) + dynamic kinematic & harmonic 4D Gaussians.
 */
export function generateTemporalGaussianScene(
  totalGaussians: number = 1200,
  durationSec: number = 5.0,
  fps: number = 30
): { scene: TemporalScene4D; polynomials: Gaussian4DPolynomial[] } {
  const polynomials: Gaussian4DPolynomial[] = [];

  const staticCount = Math.floor(totalGaussians * 0.3); // 30% Static
  const dynamicCount = totalGaussians - staticCount;     // 70% Dynamic

  // 1. Static Reference Ground Grid & Pedestal
  for (let i = 0; i < staticCount; i++) {
    const angle = (i / staticCount) * Math.PI * 2;
    const rad = 2.2 + (i % 3) * 0.4;
    const x = Math.cos(angle) * rad;
    const y = -0.8 + ((i % 5) * 0.04);
    const z = Math.sin(angle) * rad;

    // Static markers in cool slate-cyan
    polynomials.push({
      position: [x, y, z],
      scale: [0.05, 0.05, 0.05],
      color: [0.2, 0.4 + Math.random() * 0.2, 0.6],
      opacity: 0.6,
      motionDegree: 0,
      motionP1: [0, 0, 0],
      motionP2: [0, 0, 0],
      motionP3: [0, 0, 0],
    });
  }

  // 2. Dynamic 4D Central Rotating & Pulsing Core (40% of dynamic)
  const coreDynamic = Math.floor(dynamicCount * 0.4);
  for (let i = 0; i < coreDynamic; i++) {
    const theta = (i / coreDynamic) * Math.PI * 4;
    const r = 0.4 + Math.random() * 0.5;
    const x0 = r * Math.cos(theta);
    const y0 = (Math.random() - 0.5) * 0.6;
    const z0 = r * Math.sin(theta);

    // Warm golden-amber spectrum
    const colorVal: [number, number, number] = [1.0, 0.6 + Math.sin(theta) * 0.3, 0.2];

    // Kinematic & harmonic motion: vertical pulsation & radial wave
    const freq = 1.5 + Math.random() * 0.5;
    const phase = theta;
    const amp = 0.35 + Math.random() * 0.15;

    polynomials.push({
      position: [x0, y0, z0],
      scale: [0.06, 0.06, 0.06],
      color: colorVal,
      opacity: 0.85,
      motionDegree: 3,
      motionP1: [-Math.sin(theta) * 0.2, 0, Math.cos(theta) * 0.2], // Orbital drift
      motionP2: [0, 0, 0],
      motionP3: [amp, freq, phase], // Harmonic wave [Amplitude, Frequency, Phase]
    });
  }

  // 3. Dynamic 4D Flowing Dual-Helix Ribbon (60% of dynamic)
  const helixCount = dynamicCount - coreDynamic;
  for (let i = 0; i < helixCount; i++) {
    const u = (i / helixCount) * Math.PI * 6; // 3 full turns
    const helixRad = 1.3;
    const x0 = Math.cos(u) * helixRad;
    const y0 = ((i / helixCount) - 0.5) * 2.2;
    const z0 = Math.sin(u) * helixRad;

    // Vibrant emerald-violet spectrum
    const norm = i / helixCount;
    const r = 0.4 + 0.6 * Math.sin(norm * Math.PI * 2);
    const g = 0.8 - 0.3 * Math.cos(norm * Math.PI * 2);
    const b = 0.6 + 0.4 * Math.cos(norm * Math.PI * 2);

    const freq = 2.0;
    const phase = u;
    const amp = 0.25;

    polynomials.push({
      position: [x0, y0, z0],
      scale: [0.045, 0.045, 0.045],
      color: [r, g, b],
      opacity: 0.8,
      motionDegree: 2,
      motionP1: [-Math.sin(u) * 0.4, 0.1, Math.cos(u) * 0.4],
      motionP2: [0, 0, 0],
      motionP3: [amp, freq, phase],
    });
  }

  // Build Keyframe Table for Discrete Verification (e.g. t = 0, 0.25, 0.5, 0.75, 1.0)
  const totalFrames = Math.floor(durationSec * fps);
  const keyframes: TemporalKeyframe[] = [];

  const basePositions = new Float32Array(totalGaussians * 3);
  const baseScales = new Float32Array(totalGaussians * 3);
  const baseColors = new Float32Array(totalGaussians * 3);
  const baseOpacities = new Float32Array(totalGaussians);

  for (let i = 0; i < totalGaussians; i++) {
    const p = polynomials[i];
    basePositions[i * 3 + 0] = p.position[0];
    basePositions[i * 3 + 1] = p.position[1];
    basePositions[i * 3 + 2] = p.position[2];

    baseScales[i * 3 + 0] = p.scale[0];
    baseScales[i * 3 + 1] = p.scale[1];
    baseScales[i * 3 + 2] = p.scale[2];

    baseColors[i * 3 + 0] = p.color[0];
    baseColors[i * 3 + 1] = p.color[1];
    baseColors[i * 3 + 2] = p.color[2];

    baseOpacities[i] = p.opacity;
  }

  const scene: TemporalScene4D = {
    name: 'Procedural 4D Synthetic Dynamic Sequence',
    duration: durationSec,
    fps,
    frameCount: totalFrames,
    gaussianCount: totalGaussians,
    staticCount,
    dynamicCount,
    basePositions,
    baseScales,
    baseColors,
    baseOpacities,
    keyframes,
    polynomials,
  };

  return { scene, polynomials };
}
