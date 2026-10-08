/**
 * Canonical Binary Specification for .4DV Container Format (Version 1 - 4DV1).
 */

export const FOURDV_MAGIC = 0x31564434; // '4DV1' in Little-Endian (0x34, 0x44, 0x56, 0x31)
export const FOURDV_VERSION = 1;
export const FOURDV_HEADER_SIZE = 96;
export const FOURDV_TOC_ENTRY_SIZE = 32;

export const STATIC_GAUSSIAN_QUANTIZED_BYTES = 16;
export const STATIC_GAUSSIAN_FLOAT32_BYTES = 40;
export const DYNAMIC_GAUSSIAN_QUANTIZED_BYTES = 34;
export const DYNAMIC_GAUSSIAN_FLOAT32_BYTES = 76;

export enum FourDVFlags {
  NONE = 0,
  HAS_STATIC_SPLIT = 1 << 0,
  IS_QUANTIZED = 1 << 1,
  IS_COMPRESSED = 1 << 2,
  HAS_SPATIAL_MORTON = 1 << 3,
  HAS_TEMPORAL_DELTAS = 1 << 4,
}

export interface FourDVRanges {
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  scaleMax: number;
  velMax: number;
  accelMax: number;
  harmonicMax: [number, number, number]; // [ampMax, freqMax, phaseMax]
}

export interface FourDVHeader {
  magic: number;            // 4 bytes: '4DV1' (0x31564434)
  version: number;          // 2 bytes: 1
  flags: number;            // 2 bytes: bitmask (FourDVFlags)
  frameCount: number;       // 4 bytes: total temporal frame count
  fps: number;              // 4 bytes (float32): playback rate
  duration: number;         // 4 bytes (float32): duration in seconds
  totalGaussians: number;   // 4 bytes: staticGaussians + dynamicGaussians
  staticGaussians: number;  // 4 bytes: static landmark count
  dynamicGaussians: number; // 4 bytes: dynamic trajectory count
  boundsMin: [number, number, number]; // 12 bytes (3 x float32)
  boundsMax: [number, number, number]; // 12 bytes (3 x float32)
  scaleMax: number;         // 4 bytes (float32)
  velMax: number;           // 4 bytes (float32)
  accelMax: number;         // 4 bytes (float32)
  harmonicMax: [number, number, number]; // 12 bytes (3 x float32)
  tocOffset: number;        // 4 bytes: byte offset to TOC (always 96)
  tocEntries: number;       // 4 bytes: total TOC entry count (1 + numDynamicChunks)
}

export interface FourDVTocEntry {
  chunkId: number;          // 4 bytes: 0 for static block, 1..N for dynamic chunks
  timeStart: number;        // 4 bytes (float32): start timestamp in seconds
  timeEnd: number;          // 4 bytes (float32): end timestamp in seconds
  fileOffset: number;       // 4 bytes: absolute file byte offset
  byteLength: number;       // 4 bytes: compressed/stored byte length
  uncompressedLength: number; // 4 bytes: raw uncompressed payload size
  gaussianCount: number;    // 4 bytes: primitive count in this chunk
  flags: number;            // 4 bytes: chunk-specific flags
}

export interface Decoded4DScene {
  header: FourDVHeader;
  toc: FourDVTocEntry[];
  metadata: {
    title: string;
    description: string;
    creationDate: string;
    generator?: string;
    fps?: number;
    duration?: number;
    frameCount?: number;
  };
  staticAttributes: Float32Array;   // 10 floats per static Gaussian
  dynamicAttributes: Float32Array;  // 19 floats per dynamic Gaussian
  allGaussiansPacked: Float32Array; // Interleaved 19 floats per primitive for direct GPU rendering
}

