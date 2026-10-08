/**
 * Binary Specification for .4DV Container Format (Version 1 - 4DV1).
 */

export const FOURDV_MAGIC = 0x31564434; // '4DV1' in Little-Endian (0x34, 0x44, 0x56, 0x31)
export const FOURDV_VERSION = 1;

export enum FourDVFlags {
  NONE = 0,
  HAS_STATIC_SPLIT = 1 << 0,
  IS_QUANTIZED = 1 << 1,
  IS_COMPRESSED = 1 << 2,
  HAS_SPATIAL_MORTON = 1 << 3,
}

export interface FourDVHeader {
  magic: number;            // 4 bytes: '4DV1'
  version: number;          // 2 bytes: 1
  flags: number;            // 2 bytes: bitmask
  frameCount: number;       // 4 bytes
  fps: number;              // 4 bytes (float32)
  duration: number;         // 4 bytes (float32)
  totalGaussians: number;   // 4 bytes
  staticGaussians: number;  // 4 bytes
  dynamicGaussians: number; // 4 bytes
  boundsMin: [number, number, number]; // 12 bytes
  boundsMax: [number, number, number]; // 12 bytes
  tocOffset: number;        // 4 bytes
  tocEntries: number;       // 4 bytes
}

export interface FourDVTocEntry {
  chunkId: number;
  timeStart: number;
  timeEnd: number;
  fileOffset: number;
  byteLength: number;
  uncompressedLength: number;
  gaussianCount: number;
}

export interface Decoded4DScene {
  header: FourDVHeader;
  toc: FourDVTocEntry[];
  metadata: {
    title: string;
    description: string;
    creationDate: string;
  };
  staticAttributes: Float32Array;   // 10 floats per static Gaussian
  dynamicAttributes: Float32Array;  // 19 floats per dynamic Gaussian
  allGaussiansPacked: Float32Array; // Interleaved 19 floats per primitive for direct GPU rendering
}
