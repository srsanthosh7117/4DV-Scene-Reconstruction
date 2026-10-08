import { Gaussian4DPolynomial } from '../renderer/types';

export interface SeparationStats {
  totalCount: number;
  staticCount: number;
  dynamicCount: number;
  staticRatio: number;      // e.g. 0.35 (35%)
  dynamicRatio: number;     // e.g. 0.65 (65%)
  threshold: number;        // Motion threshold used for classification
  staticMemoryBytes: number;
  dynamicMemoryBytes: number;
  uncompressedTotalBytes: number;
  separatedTotalBytes: number;
  bandwidthSavedPercent: number;
}

export interface SeparatedSceneData {
  staticGaussians: Gaussian4DPolynomial[];
  dynamicGaussians: Gaussian4DPolynomial[];
  stats: SeparationStats;
}
