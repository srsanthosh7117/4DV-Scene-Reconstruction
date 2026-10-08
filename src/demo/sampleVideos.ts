import { Gaussian4DPolynomial } from '../renderer/types';
import { generateTemporalGaussianScene } from './temporalDemo';
import { generateProceduralGaussianScene } from './procedural';

export interface Sample4DVideo {
  id: string;
  name: string;
  description: string;
  gaussianCount: number;
  duration: number;
  generate: () => Gaussian4DPolynomial[];
}

export const SAMPLE_4D_VIDEOS: Sample4DVideo[] = [
  {
    id: 'dynamic-helix',
    name: 'Dynamic Dual-Helix Stream',
    description: '1,200 Gaussians with static floor landmarks and harmonic helical deformation',
    gaussianCount: 1200,
    duration: 5.0,
    generate: () => generateTemporalGaussianScene(1200, 5.0, 30).polynomials,
  },
  {
    id: 'torus-spiral',
    name: 'Oscillating Torus Spiral',
    description: '800 Gaussians with orbital velocity vectors and radial wave kinematics',
    gaussianCount: 800,
    duration: 4.0,
    generate: () => generateTemporalGaussianScene(800, 4.0, 30).polynomials,
  },
  {
    id: 'volumetric-core',
    name: 'Volumetric Pulsing Nebula',
    description: '600 Gaussians with spherical harmonic breathing and warm spectral gradients',
    gaussianCount: 600,
    duration: 3.0,
    generate: () => {
      const g3d = generateProceduralGaussianScene(600);
      return g3d.map((g, i) => ({
        ...g,
        motionDegree: 2,
        motionP1: [-Math.sin(i) * 0.15, 0.05, Math.cos(i) * 0.15] as [number, number, number],
        motionP3: [0.2, 2.0, i * 0.1] as [number, number, number],
      }));
    },
  },
];
